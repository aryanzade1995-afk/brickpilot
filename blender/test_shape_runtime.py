"""Run with Blender: -b --python-exit-code 1 --python blender/test_shape_runtime.py."""
from pathlib import Path
import sys
import unittest

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.shape import _above_plane, _raster, measure_shape, GRID


class EvaluatedShapeTests(unittest.TestCase):
    def test_crossing_vertical_faces_keep_the_full_visible_wall(self):
        vertices = [Vector(p) for p in ((0, 0, 0), (4, 0, 0), (4, 0, 4), (0, 0, 4))]
        triangles = []
        for indices in ((0, 1, 2), (0, 2, 3)):
            clipped = _above_plane([vertices[i] for i in indices], 2)
            for i in range(1, len(clipped) - 1):
                triangles.append([(v.x, v.z) for v in (clipped[0], clipped[i], clipped[i + 1])])
        self.assertEqual(sum(_raster(triangles, (0, 2, 4, 2))), GRID * GRID)

    def test_faces_below_the_datum_are_removed(self):
        self.assertEqual(_above_plane([Vector((x, 0, 1)) for x in (0, 1, 2)], 2), [])

    def test_materials_and_landscaping_do_not_affect_realized_shape(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        structure = bpy.data.collections.new('STRUCTURE')
        landscape = bpy.data.collections.new('LANDSCAPE')
        bpy.context.scene.collection.children.link(structure)
        bpy.context.scene.collection.children.link(landscape)
        bpy.ops.mesh.primitive_cube_add(size=2, location=(5, 5, 4))
        cube = bpy.context.object
        for collection in list(cube.users_collection):
            collection.objects.unlink(cube)
        structure.objects.link(cube)
        payload = {'buildingModel': {'planId': 'same-plan',
                   'floors': [{'elevationMm': 0, 'heightMm': 3000}],
                   'plot': {'widthMm': 10000, 'depthMm': 10000}},
                   'villaDesignDNA': {'seed': 17}}
        before = measure_shape(payload)
        self.assertGreater(sum(before['parts']['roofFront']), 0)
        material = bpy.data.materials.new('Any_Changed_Color')
        material.diffuse_color = (1, 0, 0, 1)
        cube.data.materials.append(material)
        bpy.ops.mesh.primitive_cube_add(size=8, location=(5, 5, 5))
        plant = bpy.context.object
        for collection in list(plant.users_collection):
            collection.objects.unlink(plant)
        landscape.objects.link(plant)
        self.assertEqual(before, measure_shape(payload))
        cube.location.x += 2
        self.assertNotEqual(before['vector'], measure_shape(payload)['vector'])


result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(EvaluatedShapeTests))
if not result.wasSuccessful():
    raise RuntimeError('Evaluated mesh measurement regression')
