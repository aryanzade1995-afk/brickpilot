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
from geometry.plates import roof_plate_regions, union_plate_mesh
from geometry.openings import create_door_opening
from unittest.mock import patch
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

    def test_storey_masonry_ends_at_slab_soffit_not_through_terrace(self):
        floor = {"id": "FF", "heightMm": 3100, "elevationMm": 3100, "slabThicknessMm": 125}
        wall = {"id": "wall", "a": {"x": 0, "y": 0}, "b": {"x": 4000, "y": 0}, "thickness": 230, "kind": "exterior"}
        scene = RecordingScene()
        create_wall(scene, wall, floor, [], 1)
        self.assertEqual(max(p["z"] + p["h"] for p in scene.boxes), 6075)
        self.assertEqual(floor["elevationMm"], 3100)

    def test_roof_bearing_union_keeps_wing_gaps_and_has_no_duplicates(self):
        floor = {"footprint": [{"x": 0, "y": 0, "w": 4000, "h": 3000}, {"x": 6000, "y": 0, "w": 2000, "h": 3000}]}
        wall = {"a": {"x": 0, "y": 0}, "b": {"x": 4000, "y": 0}, "thickness": 230}
        pieces = roof_plate_regions(floor, [wall])
        self.assertEqual(sum(p["w"] * p["h"] for p in pieces), 18000000 + 4000 * 115)
        self.assertTrue(any(p["y"] == -115 for p in pieces))
        self.assertFalse(any(p["x"] < 5000 < p["x"] + p["w"] for p in pieces))
        for i, p in enumerate(pieces):
            for q in pieces[i+1:]:
                self.assertFalse(min(p["x"]+p["w"],q["x"]+q["w"])-max(p["x"],q["x"]) > .01 and min(p["y"]+p["h"],q["y"]+q["h"])-max(p["y"],q["y"]) > .01)

    def test_flat_union_plate_has_welded_joins_real_holes_and_no_internal_ribs(self):
        rects = [{"x": 0, "y": 0, "w": 4000, "h": 3000},
                 {"x": 3000, "y": 0, "w": 4000, "h": 3000},
                 {"x": 9000, "y": 0, "w": 1000, "h": 1000}]
        hole = {"x": 1000, "y": 1000, "w": 1000, "h": 1000}
        vertices, faces = union_plate_mesh(rects, 6075, 125, [hole])
        self.assertEqual(set(p[2] for p in vertices), {6075, 6200})
        top = [f for f in faces if all(vertices[i][2] == 6200 for i in f)]
        area = 0
        for face in top:
            points = [vertices[i] for i in face]
            area += abs(sum(p[0]*points[(i+1)%4][1]-points[(i+1)%4][0]*p[1] for i,p in enumerate(points)))/2
            cx, cy = sum(p[0] for p in points)/4, sum(p[1] for p in points)/4
            self.assertFalse(1000 < cx < 2000 and 1000 < cy < 2000)
            self.assertFalse(7000 < cx < 9000)
        self.assertEqual(area, 21000000)  # actual union minus hole, plus detached wing
        edges = {}
        for face in faces:
            for i, a in enumerate(face):
                edge = tuple(sorted((a, face[(i+1)%len(face)])))
                edges[edge] = edges.get(edge, 0) + 1
        self.assertTrue(all(n == 2 for n in edges.values()), 'Watertight plate; no duplicate internal sides')
        self.assertEqual(len(vertices), len(set(vertices)))

    def test_floor_fragments_do_not_bevel_their_internal_joins(self):
        with patch.object(RecordingScene, 'rect', return_value=None) as rect:
            create_slab(RecordingScene(), {"id": "GF_SLAB_1", "rect": {"x": 0, "y": 0, "w": 4000, "h": 4000}, "topMm": 0, "thicknessMm": 125}, {"id": "GF"}, [{"x": 1000, "y": 1000, "w": 2000, "h": 2000}])
            self.assertEqual(rect.call_count, 4)
            self.assertTrue(all(c.kwargs['bevel'] == 0 for c in rect.call_args_list))

    def test_open_treatment_or_no_leaf_never_creates_a_glass_barrier(self):
        floor = self.building["floors"][0]
        wall = next(w for w in self.building["walls"] if w["floorId"] == floor["id"])
        opening = {"id": "open-test", "kind": "door", "at": wall["a"], "width": 1800, "head": 2300}
        for choices in ({"leaf": False, "treatment": "glazed-slide"}, {"leaf": True, "treatment": "open"}):
            scene = RecordingScene()
            with patch('geometry.openings._opening_anchor'):
                create_door_opening(scene, {**opening, **choices}, wall, floor)
            self.assertEqual(scene.boxes, [])

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
            # Return-flight blocks must not extend down to the ground floor.
            # They are the same stepped waists as walkthrough/stairs.ts.
            for tread in treads[count:]:
                self.assertGreater(tread["z"], floor["elevationMm"])
                self.assertLessEqual(tread["h"], rise + 150 + 0.001)
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
