"""
Stairs from the spec's per-floor StairSpec — a real stepped dog-leg flight
inside the stair core: N/2 treads up one side to a mid-landing, then N/2 back
up the other side. One `tread` mesh is created and linked-duplicated for every
step (cheap: one mesh, many objects), joined later by optimize.py.
"""

from __future__ import annotations

from .context import HAS_BPY, Spec, assign, collection, material, mm

TREAD_T = 0.045


def build(spec: Spec):
    coll = collection("Stairs")
    if not HAS_BPY:
        return coll
    import bpy  # type: ignore
    import bmesh  # type: ignore

    for fl in spec.floors:
        for st in fl["stairs"]:
            r = st["rect"]
            x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
            y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
            lo_x, hi_x = min(x0, x1), max(x0, x1)
            lo_y, hi_y = min(y0, y1), max(y0, y1)
            width = hi_x - lo_x
            depth = hi_y - lo_y
            rise = mm(st["toMm"]) - mm(st["fromMm"])
            n = max(int(st["steps"]), 12)
            per = n // 2
            base = mm(st["fromMm"])
            flight_w = width / 2 - 0.05
            going = (depth * 0.86) / per
            mid_z = base + rise * (per / n)

            # shared tread mesh
            me = bpy.data.meshes.new("stair-tread")
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, verts=bm.verts, vec=(flight_w, going * 1.05, TREAD_T))
            bm.to_mesh(me)
            bm.free()
            mat = material("stair" if "stair" in spec.materials else "trim", spec)

            def tread(name, cx, cy, cz):
                obj = bpy.data.objects.new(name, me)  # linked — one mesh, many steps
                coll.objects.link(obj)
                obj.location = (cx, cy, cz)
                assign(obj, mat)

            # flight A — near the low-x side, climbing +Y
            for k in range(per):
                z = base + (rise * (k + 1) / n)
                tread(f"{st['id']}-a{k}", lo_x + flight_w / 2 + 0.02, lo_y + going * (k + 0.5), z)
            # mid landing
            land = bpy.data.objects.new(f"{st['id']}-landing", bpy.data.meshes.new("l"))
            lb = bmesh.new()
            bmesh.ops.create_cube(lb, size=1.0)
            bmesh.ops.scale(lb, verts=lb.verts, vec=(width - 0.1, going * 2, TREAD_T))
            lb.to_mesh(land.data)
            lb.free()
            land.location = (lo_x + width / 2, hi_y - going, mid_z)
            coll.objects.link(land)
            assign(land, mat)
            # flight B — high-x side, climbing -Y
            for k in range(per):
                z = mid_z + (rise * (k + 1) / n)
                tread(f"{st['id']}-b{k}", hi_x - flight_w / 2 - 0.02, hi_y - going * (k + 0.5), z)

            # a simple stringer wall down the spine
            spine = bpy.data.objects.new(f"{st['id']}-spine", bpy.data.meshes.new("s"))
            sb = bmesh.new()
            bmesh.ops.create_cube(sb, size=1.0)
            bmesh.ops.scale(sb, verts=sb.verts, vec=(0.1, depth * 0.86, rise))
            sb.to_mesh(spine.data)
            sb.free()
            spine.location = (lo_x + width / 2, (lo_y + hi_y) / 2, base + rise / 2)
            coll.objects.link(spine)
            assign(spine, material("wall", spec))
    return coll
