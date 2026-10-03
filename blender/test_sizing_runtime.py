"""Actual Blender dimensions must agree with source concept take-off members."""
import copy
import json
import sys
from pathlib import Path
import unittest
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generator import create_scene
from geometry.sizing import clear_beam
from validation import validate_payload, GeometryInputError


class SizingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        args=sys.argv[sys.argv.index('--')+1:]
        cls.payload=json.loads(Path(args[0]).read_text(encoding='utf-8'))
        cls.q=json.loads(Path(args[1]).read_text(encoding='utf-8'))
        create_scene(cls.payload, {'landscape': {'enabled':False}})
        bpy.context.view_layer.update()
        cls.building=cls.payload['buildingModel']

    def test_footings_pedestals_plinth_beams_and_ground_grade(self):
        b=self.building;s=b['structuralSizing'];ground=min(b['floors'],key=lambda f:f['level'])
        for pad in s['footings']:
            obj=bpy.data.objects[pad['id']]
            for actual,expected in zip(obj.dimensions,(pad['rect']['w']/1000,pad['rect']['h']/1000,pad['thicknessMm']/1000)):
                self.assertAlmostEqual(actual,expected,places=4)
            self.assertEqual(obj['qualification'],s['qualification'])
            self.assertIn(f"Pedestal_{pad['columnId']}",bpy.data.objects)
        columns=[c for c in b['columns'] if c['floorId']==ground['id']]
        for beam in s['plinthBeams']:
            obj=bpy.data.objects[beam['id']]
            _,_,length=clear_beam(beam,columns)
            self.assertAlmostEqual(obj.dimensions.z,beam['depthMm']/1000,places=4)
            self.assertAlmostEqual(obj.data.vertices[0].co.x*-2,length/1000,places=4)
        surface=bpy.data.objects['Site_Ground_01']
        self.assertAlmostEqual(surface.location.z+surface.dimensions.z/2,-s['plinthHeightMm']/1000,places=4)
        self.assertEqual(bpy.context.scene['plinth_height_mm'],s['plinthHeightMm'])

    def test_column_and_beam_mesh_volumes_agree_with_takeoff(self):
        members={m['id']:m for m in self.q['total']['members']}
        for c in self.building['columns']:
            obj=bpy.data.objects[f"Column_{c['id']}"]
            self.assertAlmostEqual(obj.dimensions.x,c['size']/1000,places=4)
            self.assertAlmostEqual(obj.dimensions.x*obj.dimensions.y*obj.dimensions.z,members[c['id']]['quantities']['NetVolume'],places=4)
        for beam in self.building['beams']:
            obj=bpy.data.objects[f"Beam_{beam['id']}"]
            # Local box extents, since world dimensions rotate axis-aligned beams.
            coords=[v.co for v in obj.data.vertices]
            volume=1
            for axis in range(3):volume*=max(v[axis] for v in coords)-min(v[axis] for v in coords)
            self.assertAlmostEqual(volume,members[beam['id']]['quantities']['NetVolume'],places=4)

    def test_corrupt_sizing_is_rejected_before_meshes(self):
        for edit in ['slab','beam','footing','plinth']:
            p=copy.deepcopy(self.payload);b=p['buildingModel']
            if edit=='slab':b['slabs'][0]['thicknessMm']=-1
            if edit=='beam':b['beams'][0]['depthMm']=0
            if edit=='footing':b['structuralSizing']['footings'][0]['rect']['x']+=100
            if edit=='plinth':b['structuralSizing']['plinthHeightMm']=float('nan')
            with self.assertRaises(GeometryInputError):validate_payload(p)


if __name__=='__main__':unittest.main(argv=[sys.argv[0]],verbosity=2)
