"""
BrickPilot procedural house generator — entry point.

    blender --background --python blender/generator/house_generator.py -- \
        --spec path/to/spec.json --out path/to/villa.glb [--mode detailed]

Modes:
    study     solid massing volumes + roofs + facade (fast, the "concept" look)
    detailed  wall shells with real window/door openings + balconies (default)
    cutaway   detailed + interior partitions trimmed to 1.2 m (the dollhouse)

Without Blender (plain `python house_generator.py --spec s.json`) it runs the
spec validator only and prints the build plan — used by CI to gate a bake.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# make `from generator... import` work whether run as a file or a module
_HERE = os.path.dirname(os.path.abspath(__file__))
_BLENDER = os.path.dirname(_HERE)
if _BLENDER not in sys.path:
    sys.path.insert(0, _BLENDER)

from generator.context import HAS_BPY, Spec, reset_scene  # noqa: E402
from generator import (  # noqa: E402
    massing, floors, walls, windows, doors, roofs, balconies, facade, materials, rooms, stairs, structure, optimize,
)
from generator import validator  # noqa: E402


def _args(argv: list[str]) -> argparse.Namespace:
    # Blender: real args live after "--"; plain python: drop argv[0] (script name)
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = argv[1:]
    p = argparse.ArgumentParser(prog="house_generator")
    p.add_argument("--spec", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--mode", choices=("study", "detailed", "cutaway"), default="detailed")
    p.add_argument("--no-validate", action="store_true")
    return p.parse_args(argv)


def build_scene(spec: Spec, mode: str) -> dict:
    reset_scene()
    materials.build(spec)

    if mode == "study":
        massing.build(spec)
        structure.build(spec)
        roofs.build(spec)
        facade.build(spec)
        balconies.build(spec)
    else:
        # STRUCTURE first (§10) — columns / beams / slabs are the frame the
        # walls, openings, balconies and facade all hang off
        structure.build(spec)
        floors.build(spec)
        _coll, wall_objs = walls.build(spec, detailed=True)
        windows.build(spec, wall_objs)
        doors.build(spec, wall_objs, include_internal=(mode == "cutaway"))
        stairs.build(spec)
        roofs.build(spec)
        balconies.build(spec)
        facade.build(spec)
        if mode == "cutaway":
            rooms.build(spec)

    return optimize.finalize(spec)


def main() -> int:
    ns = _args(sys.argv)
    spec = Spec.load(ns.spec)

    ok, issues = validator.check_spec(spec)
    g = spec.genome or {}
    print(f"[spec] {spec.raw['id']}  style={spec.style}  seed={spec.seed}  "
          f"floors={len(spec.floors)}  strategy={spec.massing['strategy']}  "
          f"windows={sum(len(f['windows']) for f in spec.floors)}  ok={ok}")
    if g:
        print(f"  genome: {g.get('massingComposition')} / {g.get('planFigure')} / {g.get('volumeCount')} vol"
              f"  roof={g.get('roof')}  entrance={g.get('entrance')}{' (2H)' if g.get('doubleHeightEntrance') else ''}"
              f"  balcony={g.get('balcony')}  facade={g.get('facadeComposition')}+{g.get('screen')}"
              f"  court={g.get('courtyard')}  fp={(spec.fingerprint or {}).get('hash', '?')}")
        if g.get("repaired"):
            print(f"  ~ genome repaired: {'; '.join(g['repaired'])}")
    a = spec.audit or {}
    if a:
        struct = sum(len(f.get("columns", [])) for f in spec.floors)
        beams = sum(len(f.get("beams", [])) for f in spec.floors)
        slabs = sum(len(f.get("slabs", [])) for f in spec.floors)
        print(f"  structure: {struct} columns / {beams} beams / {slabs} slabs   "
              f"audit score={a.get('score')} errors={len(a.get('errors', []))} warnings={len(a.get('warnings', []))}")
        for e in a.get("errors", []):
            print(f"  [err] {e.get('message', e)}")
    for it in issues:
        print(f"  ! {it}")
    if spec.validation.get("repaired"):
        print(f"  ~ grammar repaired {len(spec.validation['repaired'])} item(s)")
    if not ok and not ns.no_validate:
        print("[abort] spec failed validation")
        return 2

    if not HAS_BPY:
        print("[dry-run] no Blender (bpy) — spec is valid, nothing built")
        return 0 if ok else 2

    gstats = build_scene(spec, ns.mode)

    sok, sissues = validator.check_scene(spec)
    for it in sissues:
        print(f"  ! scene: {it}")
    if not sok and not ns.no_validate:
        print("[abort] built geometry failed validation")
        return 3

    out = ns.out or os.path.splitext(ns.spec)[0] + ".glb"
    from export import export_glb

    size = export_glb(out)
    print(f"[ok] {out}  ({size / 1024:.0f} KB, {gstats['objects']} objects, {gstats['tris']} tris)")
    # a sidecar manifest the viewer / catalog reads
    with open(os.path.splitext(out)[0] + ".json", "w", encoding="utf-8") as fh:
        json.dump(
            {"id": spec.raw["id"], "style": spec.style, "seed": spec.seed, "mode": ns.mode,
             "bytes": size, "objects": gstats["objects"], "tris": gstats["tris"]},
            fh,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
