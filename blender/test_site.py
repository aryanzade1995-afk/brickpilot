"""Site geometry and landscaping integration checks without the Blender API."""
import json
from pathlib import Path
import sys
import unittest
from copy import deepcopy
from geometry.site import create_site, validate_site_features, overlaps, SITE_LEVELS
from visualization.placement import planting_layout
from visualization.config import visualization_options


class RecordingScene:
    def __init__(self):
        self.objects = []

    def rect(self, name, collection, rect, bottom, height, material="concrete", source_id=None, bevel=8):
        obj = {"name": name, "rect": dict(rect), "bottom": bottom, "height": height,
               "material": material, "source_id": source_id}
        self.objects.append(obj)
        return obj


class SiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = [json.loads(Path(p).read_text(encoding="utf-8")) for p in sys.argv[1:]]

    def test_all_four_modes_keep_exact_site_rectangles_and_source_geometry(self):
        self.assertEqual(len(self.inputs), 4)
        for payload in self.inputs:
            b = payload["buildingModel"]
            before = deepcopy(b)
            scene = RecordingScene()
            create_site(scene, b)
            for f in b["siteFeatures"]:
                if not f["covered"]:
                    obj = next(o for o in scene.objects if o["name"] == f["id"])
                    self.assertEqual(obj["rect"], f["rect"])
                    self.assertEqual(obj["source_id"], f["id"])
            self.assertEqual(b, before)

    def test_pool_is_below_grade_and_both_ground_surfaces_have_a_real_hole(self):
        for payload in self.inputs:
            b, scene = payload["buildingModel"], RecordingScene()
            create_site(scene, b)
            pool = next(f for f in b["siteFeatures"] if f["kind"] == "pool")
            water = next(o for o in scene.objects if o["name"] == pool["id"])
            self.assertLess(water["bottom"] + water["height"], SITE_LEVELS["grade"])
            for name in ("Site_Ground", "Ground_Context"):
                pieces = [o for o in scene.objects if o["name"].startswith(name)]
                self.assertTrue(pieces)
                self.assertFalse(any(overlaps(o["rect"], pool["rect"]) for o in pieces))
            self.assertEqual(len([o for o in scene.objects if o["name"].startswith(pool["id"] + "_Side")]), 4)

    def test_planters_never_block_planned_parking_driveway_paths_pool_or_utility_yard(self):
        for payload in self.inputs:
            layout = planting_layout(payload, visualization_options(payload))
            reserved = [f["rect"] for f in payload["buildingModel"]["siteFeatures"] if f["kind"] != "lawn"]
            for p in layout["planters"]:
                if p["category"] in ("entry", "side"):
                    self.assertFalse(any(overlaps(p["envelope"], r) for r in reserved))

    def test_conflicting_or_out_of_plot_source_features_are_rejected(self):
        b = deepcopy(self.inputs[0]["buildingModel"])
        b["siteFeatures"][0]["rect"]["x"] = -1
        with self.assertRaisesRegex(ValueError, "boundary"):
            validate_site_features(b)
        b = deepcopy(self.inputs[0]["buildingModel"])
        pool = next(f for f in b["siteFeatures"] if f["kind"] == "pool")
        pool["rect"] = dict(b["rooms"][0]["rect"])
        with self.assertRaisesRegex(ValueError, "intersects"):
            validate_site_features(b)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
