"""Runs without Blender: validates the handoff and checks real wall voids."""

import json
from pathlib import Path
import sys
import types
import unittest

sys.modules.setdefault("bpy", types.ModuleType("bpy"))
sys.modules.setdefault("bmesh", types.ModuleType("bmesh"))
from geometry.structure import create_wall, create_slab, create_staircase  # noqa: E402
from geometry.plates import subtract_rectangles  # noqa: E402
from geometry.stairs import stair_layout, stair_opening  # noqa: E402
from geometry.massing import mass_rect  # noqa: E402
from validation import GeometryInputError, opening_hosts, opening_vertical_span, validate_payload  # noqa: E402
from specialized_validation import resolve_anchor, derive_world  # noqa: E402


class RecordingScene:
    def __init__(self):
        self.boxes = []

    def box(self, name, collection, x, y, z, width, depth, height,
            material="wall", source_id=None, bevel=8):
        self.boxes.append({"name": name, "collection": collection,
                           "x": x, "y": y, "z": z, "w": width, "d": depth,
                           "h": height, "source_id": source_id})

    def rect(self, name, collection, rect, bottom, height, material="concrete", source_id=None, bevel=8):
        return self.box(name, collection, rect["x"] + rect["w"] / 2,
                        rect["y"] + rect["h"] / 2, bottom,
                        rect["w"], rect["h"], height, material, source_id, bevel)


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        cls.building = cls.payload["buildingModel"]

    def test_payload_identity_and_hosts(self):
        hosts = validate_payload(self.payload)
        self.assertEqual(len(hosts), len(self.building["doors"]) + len(self.building["windows"]))
        altered = json.loads(json.dumps(self.payload))
        altered["massingModel"]["sourcePlanId"] = "another-plan"
        with self.assertRaises(GeometryInputError):
            validate_payload(altered)
        altered = json.loads(json.dumps(self.payload))
        altered["buildingModel"]["windows"][0]["sill"] = 2200
        with self.assertRaisesRegex(GeometryInputError, "usable height"):
            validate_payload(altered)

    def test_all_source_door_and_window_voids_are_empty(self):
        scene = RecordingScene()
        hosts = opening_hosts(self.building)
        floors = {floor["id"]: floor for floor in self.building["floors"]}
        openings = [*self.building["doors"], *self.building["windows"]]
        serial = 1
        for wall in self.building["walls"]:
            serial = create_wall(scene, wall, floors[wall["floorId"]],
                                 [o for o in openings if hosts[o["id"]] == wall["id"]], serial)
        for opening in openings:
            wall = next(w for w in self.building["walls"] if w["id"] == hosts[opening["id"]])
            axis = opening["orient"]
            at = opening["at"]["x" if axis == "h" else "y"]
            lo, hi = at - opening["width"] / 2, at + opening["width"] / 2
            floor = floors[opening["floorId"]]
            sill, head = opening_vertical_span(opening, floor)
            for piece in (p for p in scene.boxes if p["source_id"] == wall["id"]):
                piece_lo = (piece["x"] - piece["w"] / 2) if axis == "h" else (piece["y"] - piece["d"] / 2)
                piece_hi = (piece["x"] + piece["w"] / 2) if axis == "h" else (piece["y"] + piece["d"] / 2)
                along = min(hi, piece_hi) - max(lo, piece_lo)
                vertical = min(floor["elevationMm"] + head, piece["z"] + piece["h"]) - max(floor["elevationMm"] + sill, piece["z"])
                self.assertFalse(along > 2 and vertical > 2,
                                 f"{opening['id']} is covered by {piece['name']}")

    def test_stairs_ascend_in_flight_order_and_connect_to_destination(self):
        floors = {floor["id"]: floor for floor in self.building["floors"]}
        for stair in self.building["stairs"]:
            floor = floors[stair["floorId"]]
            scene = RecordingScene()
            create_staircase(scene, stair, floor)
            treads = [piece for piece in scene.boxes if "_Tread_" in piece["name"]]
            layout = stair_layout(stair)
            count = layout["steps_per_flight"]
            self.assertEqual(len(treads), count * 2 - 1)
            levels = [piece["z"] + piece["h"] for piece in treads]
            self.assertEqual(levels, sorted(levels))
            rise = floor["heightMm"] / (count * 2)
            self.assertAlmostEqual(levels[-1] + rise, floor["elevationMm"] + floor["heightMm"])
            side = stair.get("startSide", "N")
            axis, sign = ("y", 1 if side == "N" else -1) if side in ("N", "S") else ("x", 1 if side == "W" else -1)
            first = [tread[axis] * sign for tread in treads[:count]]
            second = [tread[axis] * sign for tread in treads[count:]]
            self.assertEqual(first, sorted(first))
            self.assertEqual(second, sorted(second, reverse=True))

    def test_upper_slab_preserves_landing_and_leaves_stair_core_empty(self):
        floors = {floor["id"]: floor for floor in self.building["floors"]}
        for slab in self.building["slabs"]:
            floor = floors[slab["floorId"]]
            incoming = [stair for stair in self.building["stairs"]
                        if floors[stair["floorId"]]["level"] == floor["level"] - 1]
            scene = RecordingScene()
            create_slab(scene, slab, floor, [stair_opening(stair) for stair in incoming])
            for stair in incoming:
                cut = stair_opening(stair)
                for piece in scene.boxes:
                    overlap_x = min(cut["x"] + cut["w"], piece["x"] + piece["w"] / 2) - max(cut["x"], piece["x"] - piece["w"] / 2)
                    overlap_y = min(cut["y"] + cut["h"], piece["y"] + piece["d"] / 2) - max(cut["y"], piece["y"] - piece["d"] / 2)
                    self.assertFalse(overlap_x > 0.01 and overlap_y > 0.01)
                core_area = stair["rect"]["w"] * stair["rect"]["h"]
                removed_area = cut["w"] * cut["h"]
                self.assertGreater(core_area - removed_area, 0, "Destination landing must remain")

    def test_plate_subtraction_has_exact_area_and_no_overlapping_fragments(self):
        pieces = subtract_rectangles({"x": 0, "y": 0, "w": 1000, "h": 1000},
                                    [{"x": 100, "y": 100, "w": 300, "h": 300},
                                     {"x": 200, "y": 200, "w": 300, "h": 300}])
        self.assertEqual(sum(piece["w"] * piece["h"] for piece in pieces), 860000)
        for index, first in enumerate(pieces):
            for second in pieces[index + 1:]:
                overlap_x = min(first["x"] + first["w"], second["x"] + second["w"]) - max(first["x"], second["x"])
                overlap_y = min(first["y"] + first["h"], second["y"] + second["h"]) - max(first["y"], second["y"])
                self.assertFalse(overlap_x > 0 and overlap_y > 0)

    def test_stair_nosing_coordinates_work_on_all_four_entry_edges(self):
        for side in ("N", "S", "W", "E"):
            rect = {"x": 1000, "y": 2000, "w": 2400 if side in ("N", "S") else 3300,
                    "h": 3300 if side in ("N", "S") else 2400}
            def point(a, b):
                x, y = {"N": (a, b), "S": (a, 3300 - b),
                        "W": (b, a), "E": (3300 - b, a)}[side]
                return {"x": rect["x"] + x, "y": rect["y"] + y}
            stair = {"id": "test-stair", "rect": rect, "startSide": side,
                     "treads": [line for i in range(1, 9) for line in
                                ([point(0, i * 250), point(1150, i * 250)],
                                 [point(1250, i * 250), point(2400, i * 250)])]}
            layout = stair_layout(stair)
            self.assertEqual(layout["going"], 250)
            self.assertEqual(layout["travel"], 2250)
            opening = stair_opening(stair)
            self.assertEqual(opening["w"] * opening["h"], 2400 * 3050)
            scene = RecordingScene()
            create_staircase(scene, stair, {"id": "GF", "elevationMm": 0, "heightMm": 3100})
            self.assertEqual(len(scene.boxes), 18)

    def test_rotated_mass_uses_its_world_footprint_for_geometry_and_setbacks(self):
        mass = {"id": "rotated", "x": 100, "y": 200, "width": 4000, "depth": 2000, "rotation": 90}
        self.assertEqual(mass_rect(mass), {"x": 1100, "y": -800, "w": 2000, "h": 4000})
        with self.assertRaises(ValueError):
            mass_rect({**mass, "rotation": 45})

    def test_specialized_geometry_cannot_bypass_source_anchors_and_main_door(self):
        model = self.payload["facadeGrammar"].get("specialized")
        if model is None:
            self.skipTest("Baseline legacy input has no specialized grammars")
        changed = json.loads(json.dumps(self.payload))
        changed["facadeGrammar"]["specialized"]["assemblies"][0]["parts"][0]["world"]["x"] += 1
        with self.assertRaisesRegex(ValueError, "Unanchored"):
            validate_payload(changed)
        changed = json.loads(json.dumps(self.payload))
        changed["facadeGrammar"]["specialized"]["seed"] += 1
        with self.assertRaisesRegex(ValueError, "stale"):
            validate_payload(changed)
        entry = next((u for u in model["assemblies"] if u["category"] == "ENTRANCE"), None)
        if entry:
            changed = json.loads(json.dumps(self.payload))
            next(u for u in changed["facadeGrammar"]["specialized"]["assemblies"] if u["id"] == entry["id"])["openingIds"] = []
            with self.assertRaisesRegex(ValueError, "main door"):
                validate_payload(changed)

    def test_specialized_roof_cannot_block_the_source_stair_exit(self):
        model = self.payload["facadeGrammar"].get("specialized")
        if model is None:
            self.skipTest("Baseline legacy input has no specialized grammars")
        top = max(self.building["floors"], key=lambda f: f["level"])
        stair = next((s for s in self.building["stairs"] if s["floorId"] == top["id"]), None)
        if stair is None:
            self.skipTest("Source plan has no roof stair")
        changed = json.loads(json.dumps(self.payload))
        anchor = {"kind": "ROOF", "sourceId": top["id"], "floorId": top["id"]}
        a = resolve_anchor(self.building, changed["massingModel"], anchor)
        b = {"u": stair["rect"]["x"] - a["x"] + 100, "v": stair["rect"]["y"] - a["y"] + 100,
             "z": 0, "w": 200, "d": 200, "h": 1000}
        changed["facadeGrammar"]["specialized"]["assemblies"].append({
            "id": "blocked-roof", "category": "ROOFLINE", "type": "FLAT_PARAPET", "sourceRoomIds": [], "openingIds": [],
            "parts": [{"id": "blocked-roof-part", "anchor": anchor, "local": b, "world": derive_world(a, b), "role": "rail", "operation": "ADD"}]})
        with self.assertRaisesRegex(ValueError, "stair or shaft"):
            validate_payload(changed)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
