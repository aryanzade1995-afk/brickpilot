"""
Geometry-level validation of the built scene (post-generation) and of the raw
spec (pre-generation, runs without bpy so CI can gate a bake).

Mirrors src/architecture/generator/validator.ts. Returns (ok, issues).
"""

from __future__ import annotations

from .context import HAS_BPY, Spec, mm


# --------------------------------------------------------------------------- #
#  spec-level checks (no bpy)                                                 #
# --------------------------------------------------------------------------- #

def check_spec(spec: Spec) -> tuple[bool, list[str]]:
    issues: list[str] = []
    sb = spec.setbacks
    bx0, by0 = sb["W"], sb["N"]
    bx1, by1 = spec.plot_w - sb["E"], spec.plot_d - sb["S"]

    ground_area = 0.0
    for fl in spec.floors:
        if not fl["blocks"]:
            issues.append(f"{fl['name']}: no massing blocks")
        for blk in fl["blocks"]:
            r = blk["rect"]
            cant = blk.get("cantilever", {}) or {}
            slack = max([0] + list(cant.values())) + 80
            if r["x"] < bx0 - slack or r["y"] < by0 - slack or r["x"] + r["w"] > bx1 + slack or r["y"] + r["h"] > by1 + slack:
                issues.append(f"{blk['id']}: block outside the buildable envelope")
            if r["w"] < 2000 or r["h"] < 2000:
                issues.append(f"{blk['id']}: degenerate block {r['w']:.0f}x{r['h']:.0f}")
            if blk["level"] == 0:
                ground_area += r["w"] * r["h"]

        # window sanity
        per_room: dict[str, int] = {}
        for w in fl["windows"]:
            per_room[w["roomId"]] = per_room.get(w["roomId"], 0) + 1
            wall_len = ((w["wall"]["b"]["x"] - w["wall"]["a"]["x"]) ** 2 + (w["wall"]["b"]["y"] - w["wall"]["a"]["y"]) ** 2) ** 0.5
            if w["widthMm"] > wall_len + 5:
                issues.append(f"{w['id']}: wider than its wall")
            if w["widthMm"] < 250 or w["heightMm"] < 350:
                issues.append(f"{w['id']}: tiny opening")
        for rid, n in per_room.items():
            if n > 3:
                issues.append(f"{rid} ({fl['name']}): {n} windows (> 3)")

    coverage = ground_area / (spec.plot_w * spec.plot_d)
    if coverage > 0.7:
        issues.append(f"coverage {coverage * 100:.0f}% too high")

    # ---- structural + architectural sanity (mirrors architecturalValidator.ts)
    ground = next((f for f in spec.floors if f["level"] == 0), None)
    if ground is not None and not any(d["kind"] == "entry" for d in ground.get("doors", [])):
        issues.append("no entrance door on the ground floor")
    for fl in spec.floors:
        if fl["level"] > 0 and not fl.get("slabs"):
            issues.append(f"{fl['name']}: no floor slab")
        for b in fl.get("balconies", []):
            room_ids = {r["id"] for r in fl["rooms"]}
            if b["roomId"] not in room_ids:
                issues.append(f"balcony {b['id']}: no host room")
    if len(spec.floors) > 1:
        top = max(f["level"] for f in spec.floors)
        for fl in spec.floors:
            if fl["level"] < top and not fl.get("stairs"):
                issues.append(f"{fl['name']}: no stair to the floor above")
    for el in spec.facade:
        if not el.get("anchor"):
            issues.append(f"facade {el['kind']}: no anchor")

    # the TS audit's own verdict — major errors block the bake
    for e in spec.audit.get("errors", []):
        issues.append(f"audit: {e.get('message', e)}")
    for it in spec.validation.get("issues", []):
        issues.append(f"grammar: {it}")

    return (len(issues) == 0, issues)


# --------------------------------------------------------------------------- #
#  scene-level checks (needs bpy)                                             #
# --------------------------------------------------------------------------- #

def check_scene(spec: Spec) -> tuple[bool, list[str]]:
    if not HAS_BPY:
        return (True, [])
    import bpy  # type: ignore

    issues: list[str] = []
    half_w = mm(spec.plot_w) / 2 + 1.0
    half_d = mm(spec.plot_d) / 2 + 1.0
    n = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        n += 1
        bb = [obj.matrix_world @ v.co for v in [type("V", (), {"co": c})() for c in obj.bound_box]]
        xs = [p.x for p in bb]
        ys = [p.y for p in bb]
        zs = [p.z for p in bb]
        if min(zs) < -0.5:
            issues.append(f"{obj.name}: below ground ({min(zs):.2f} m)")
        if max(xs) > half_w * 1.6 or max(ys) > half_d * 1.6 or min(xs) < -half_w * 1.6:
            issues.append(f"{obj.name}: far outside the plot")
        if len(obj.data.polygons) == 0:
            issues.append(f"{obj.name}: empty mesh")
    if n < 4:
        issues.append(f"only {n} meshes — generation likely failed")
    return (len(issues) == 0, issues)
