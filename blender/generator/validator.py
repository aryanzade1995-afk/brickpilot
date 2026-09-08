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

    # trust the TS validator's own verdict too
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
