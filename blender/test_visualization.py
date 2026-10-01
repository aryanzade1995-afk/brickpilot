"""Pure configuration and source-placement checks; no Blender required."""

import json
from pathlib import Path
import sys
import unittest
from copy import deepcopy

from visualization.palettes import PALETTES, LEGACY_PALETTES, palette_specs, resolve_palette
from visualization.config import visualization_options
from visualization.placement import planting_layout, overlaps, opening_box, clear_roof_pad, supported
from visualization.landscape import SeedStream


class VisualizationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

    def test_seven_curated_palettes_have_all_semantic_pbr_roles(self):
        roles = {"primary_wall", "secondary_wall", "accent", "stone", "wood", "metal", "glass", "door", "railing"}
        self.assertEqual(len(PALETTES), 7)
        self.assertEqual(len({json.dumps(palette_specs(name), sort_keys=True) for name in PALETTES}), 7)
        for name in PALETTES:
            specs = palette_specs(name)
            self.assertEqual(set(specs), roles)
            self.assertEqual(specs["glass"]["ior"], 1.45)
            self.assertEqual(specs["glass"]["transmission"], 1)
            self.assertGreater(specs["metal"]["metallic"], .85)
            self.assertGreater(specs["primary_wall"]["roughness"], .65)
        for alias, name in LEGACY_PALETTES.items():
            self.assertEqual(resolve_palette(alias), name)
        with self.assertRaises(ValueError):
            resolve_palette("random-finish")

    def test_preview_final_presets_and_source_immutability(self):
        before = deepcopy(self.payload)
        preview = visualization_options(self.payload)
        final = visualization_options(self.payload, {"render": {"quality": "final"}})
        self.assertEqual((preview["render"]["engine"], preview["render"]["samples"]), ("EEVEE", 32))
        self.assertEqual((final["render"]["engine"], final["render"]["samples"]), ("CYCLES", 128))
        self.assertEqual(self.payload, before)
        self.assertEqual(sum(preview["composition"].values()), 1)

    def test_invalid_render_composition_paths_and_dimensions_fail_before_blender(self):
        for invalid in ({"palette": "unknown"}, {"render": {"camera": "Unknown"}}, {"render": {"resolution": [64, 800]}},
                        {"render": {"samples": float("nan")}}, {"lighting": {"hdriPath": "missing-test.hdr"}},
                        {"composition": {"primary": .9, "secondary": .05, "accent": .05}},
                        {"surfaces": {"jointMm": 50}}, {"landscape": {"leavesPerPlant": True}}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                visualization_options(self.payload, invalid)

    def test_planting_is_deterministic_and_respects_parking_and_door_approaches(self):
        before = deepcopy(self.payload)
        options = visualization_options(self.payload)
        layout = planting_layout(self.payload, options)
        self.assertEqual(layout, planting_layout(self.payload, options))
        self.assertEqual(self.payload, before)
        b = self.payload["buildingModel"]
        ground = min(b["floors"], key=lambda f: f["level"])
        for plan in layout["planters"]:
            rect = plan["envelope"]
            self.assertGreaterEqual(rect["x"], 0)
            self.assertLessEqual(rect["x"] + rect["w"], b["plot"]["widthMm"])
            self.assertGreaterEqual(rect["y"], 0)
            self.assertLessEqual(rect["y"] + rect["h"], b["plot"]["depthMm"])
            if plan["category"] in ("side", "entry"):
                self.assertFalse(any(overlaps(rect, room["rect"]) for room in b["rooms"] if room["floorId"] == ground["id"]))
                self.assertFalse(any(overlaps(rect, opening_box(o, 1000)) for o in b["doors"] if o["floorId"] == ground["id"]))
        self.assertTrue(any(p["category"] == "side" for p in layout["planters"]))

    def test_roof_greenery_requires_actual_stair_support_and_clear_route(self):
        b, m = self.payload["buildingModel"], deepcopy(self.payload["massingModel"])
        self.assertIsNone(clear_roof_pad(b, m))
        m["masses"] = [mass for mass in m["masses"] if mass["usage"] != "roof"]
        candidate = clear_roof_pad(b, m)
        self.assertIsNotNone(candidate)
        self.assertTrue(supported(candidate["pad"], candidate["floor"]["footprint"]))
        self.assertTrue(all(supported(route, candidate["floor"]["footprint"]) for route in candidate["routes"]))
        open_roof = deepcopy(self.payload); open_roof["massingModel"] = m
        layout = planting_layout(open_roof, visualization_options(open_roof))
        greenery = [plan for plan in layout["planters"] if plan["category"] == "terrace"]
        self.assertTrue(greenery, "Accessible roof should receive actual greenery")
        self.assertTrue(all(not any(overlaps(plan["envelope"], leg) for leg in candidate["routes"]) for plan in greenery))
        no_stair = deepcopy(b); no_stair["stairs"] = []
        self.assertIsNone(clear_roof_pad(no_stair, m))

    def test_numeric_seed_botanical_variation_and_landscape_toggle(self):
        first, repeat, different = SeedStream(41, "entry"), SeedStream(41, "entry"), SeedStream(42, "entry")
        numbers = [first.next() for _ in range(12)]
        self.assertEqual(numbers, [repeat.next() for _ in range(12)])
        self.assertNotEqual(numbers, [different.next() for _ in range(12)])
        options = visualization_options(self.payload, {"landscape": {"enabled": False}})
        self.assertEqual(planting_layout(self.payload, options)["planters"], [])


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
