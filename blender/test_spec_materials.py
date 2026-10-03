"""Real specification assets and editable material-node smoke test."""
import json
from pathlib import Path
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from visualization.spec_materials import REGISTRY, ROOT, material_spec, create_spec_material, specification_intent

try:
    import bpy
except ImportError:
    bpy = None


class SpecificationMaterialsTest(unittest.TestCase):
    @unittest.skipIf(bpy is None, "Run in Blender for editable geometry/material checks")
    def test_project_finishes_are_scoped_and_do_not_change_existing_geometry(self):
        from geometry.common import SceneBuilder
        from visualization.spec_materials import apply_specifications
        scene = SceneBuilder("test-plan")
        wall = scene.box("GF_Wall_001", "WALLS", 1500, 0, 0, 3000, 230, 3000, source_id="w1")
        glass = scene.box("Window_W01", "WINDOWS", 0, 0, 1000, 1000, 10, 1000, "glass")
        before = [tuple(v.co) for v in wall.data.vertices]
        original_glass = glass.data.materials[0]
        building = {"floors": [{"id": "GF", "level": 0, "elevationMm": 0}],
            "walls": [{"id": "w1", "floorId": "GF", "kind": "exterior"}], "doors": [], "stairs": [], "shafts": [],
            "rooms": [{"floorId": "GF", "semanticId": "living", "outdoor": False,
                       "rect": {"x": 0, "y": 0, "w": 3000, "h": 3000}}]}
        report = apply_specifications(scene, building, {"signature": "finish-a", "houses": [
            {"item": "exterior-paint", "option": "basic", "material": "white_plaster"}], "rooms": [
            {"level": 0, "sourceId": "living", "finishes": [
                {"item": "floor-living", "option": "wood", "material": "teak_wood"},
                {"item": "interior-paint", "option": "lime", "material": "lime_plaster"}]}]})
        self.assertEqual(before, [tuple(v.co) for v in wall.data.vertices])
        self.assertEqual(original_glass, glass.data.materials[0])
        floors = list(scene.collections["FINISHES"].objects)
        self.assertEqual(len(floors), 1)
        self.assertEqual(floors[0].data.materials[0]["specification_id"], "teak_wood")
        self.assertIn("floor-living", report["applied"])
        self.assertEqual(bpy.context.scene["finish_signature"], "finish-a")

    @unittest.skipIf(bpy is None, "Run in Blender for palette checks")
    def test_exterior_palette_is_not_replaced_by_finish_textures(self):
        from geometry.common import SceneBuilder
        from visualization.spec_materials import apply_specifications
        scene = SceneBuilder("palette-test")
        facade = scene.box("Hero_Stone", "FACADE", 0, 0, 0, 1000, 200, 2500, "stone")
        roof = scene.box("GF_Slab", "ROOF", 0, 0, 3000, 3000, 3000, 150, "wall")
        door = scene.box("Door_Main", "DOORS", 0, 0, 0, 1500, 100, 2200, "wood", source_id="d1")
        originals = [obj.data.materials[0] for obj in (facade, roof, door)]
        building = {"floors": [], "walls": [], "doors": [{"id": "d1", "kind": "entry"}], "rooms": [], "stairs": [], "shafts": []}
        result = apply_specifications(scene, building, {"signature": "exterior-finish", "rooms": [], "houses": [
            {"item": "facade-cladding", "option": "stone", "material": "grey_stone"},
            {"item": "roof-type", "option": "tiles", "material": "terracotta_tile"},
            {"item": "main-door", "option": "teak", "material": "teak_wood"}]})
        self.assertEqual(originals, [obj.data.materials[0] for obj in (facade, roof, door)])
        self.assertEqual(result["applied"], [])

    def test_villa_finish_choices_remain_metadata_without_texture_application(self):
        payload = {"signature": "chosen-finishes", "houses": [{"item": "windows"}],
                   "rooms": [{"finishes": [{"item": "floor-living"}]}]}
        original = json.dumps(payload)
        result = specification_intent(payload)
        self.assertEqual(result["applied"], [])
        self.assertEqual(result["signature"], "chosen-finishes")
        self.assertEqual(result["unmodelled"], ["floor-living", "windows"])
        self.assertEqual(json.dumps(payload), original)

    def test_every_registry_texture_and_web_copy_exists(self):
        for entry in json.loads(REGISTRY.read_text())["materials"]:
            spec, path = material_spec(entry["id"])
            self.assertTrue(path.is_file())
            self.assertTrue((ROOT / spec["webFile"]).is_file())
            self.assertGreaterEqual(max(spec["width"], spec["height"]), 1600)
        with self.assertRaises(ValueError):
            material_spec("unregistered")

    @unittest.skipIf(bpy is None, "Run in Blender to inspect actual shader nodes")
    def test_editable_shader_uses_exact_catalogue_texture(self):
        for entry in json.loads(REGISTRY.read_text())["materials"]:
            material = create_spec_material(entry["id"])
            images = [n for n in material.node_tree.nodes if n.type == "TEX_IMAGE"]
            self.assertEqual(len(images), 1)
            self.assertEqual(Path(images[0].image.filepath).resolve(), (ROOT / entry["texture"]).resolve())
            self.assertEqual(images[0].projection, "BOX")
            self.assertEqual(material["source_texture"], entry["texture"])
            self.assertTrue(any(l.to_socket.name == "Base Color" for l in material.node_tree.links))


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SpecificationMaterialsTest)
    if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        raise SystemExit(1)
