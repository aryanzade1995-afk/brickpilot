"""Real specification assets and editable material-node smoke test."""
import json
from pathlib import Path
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from visualization.spec_materials import REGISTRY, ROOT, material_spec, create_spec_material

try:
    import bpy
except ImportError:
    bpy = None


class SpecificationMaterialsTest(unittest.TestCase):
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
