"""
Windows from the spec's per-room WindowSpec list: cut the opening through the
exterior wall shell, then place a frame + a glass pane. Style reads through the
`kind` (standard / privacy / picture / strip / clerestory / ventilator) and the
frame material.
"""

from __future__ import annotations

from .context import Spec, add_box, assign, boolean_cut, collection, linked_box, material, mm

FRAME_T = 0.06
GLASS_T = 0.02


def _wall_point(spec: Spec, w: dict) -> tuple[float, float, str]:
    """centre of the opening in world XY + the world axis it runs along ('x'/'y')"""
    a, b = w["wall"]["a"], w["wall"]["b"]
    ax, ay = spec.wx(a["x"]), spec.wy(a["y"])
    bx, by = spec.wx(b["x"]), spec.wy(b["y"])
    dx, dy = bx - ax, by - ay
    ln = (dx * dx + dy * dy) ** 0.5 or 1.0
    t = mm(w["centerMm"]) / (ln)
    return ax + dx * t, ay + dy * t, ("x" if abs(dx) > abs(dy) else "y")


def build(spec: Spec, wall_objs: dict):
    coll = collection("Windows")
    for fl in spec.floors:
        L = fl["level"]
        base = mm(fl["baseMm"])
        for w in fl["windows"]:
            cx, cy, axis = _wall_point(spec, w)
            width = mm(w["widthMm"])
            height = mm(w["heightMm"])
            sill = mm(w["sillMm"])
            zc = base + sill + height / 2

            if axis == "x":
                cutter_size = (width, 0.6, height)
                frame_size = (width + 0.12, FRAME_T, height + 0.12)
                glass_size = (width - 0.04, GLASS_T, height - 0.04)
            else:
                cutter_size = (0.6, width, height)
                frame_size = (FRAME_T, width + 0.12, height + 0.12)
                glass_size = (GLASS_T, width - 0.04, height - 0.04)

            # cut the opening
            cutter = add_box(f"{w['id']}-cut", coll, (cx, cy, zc), cutter_size)
            for host in wall_objs.get((L, w["side"]), []):
                dupe = None
                if cutter is not None:
                    dupe = add_box(f"{w['id']}-cutd", coll, (cx, cy, zc), cutter_size)
                boolean_cut(host, dupe, delete_cutter=True)
            if cutter is not None:
                import bpy  # type: ignore

                bpy.data.objects.remove(cutter, do_unlink=True)

            frame = add_box(f"{w['id']}-frame", coll, (cx, cy, zc), frame_size)
            assign(frame, material("frame", spec))
            if w["kind"] != "ventilator":
                glass = add_box(f"{w['id']}-glass", coll, (cx, cy, zc), glass_size)
                assign(glass, material("glass", spec))

            # mullion bars for a wide slider / picture wall
            n = int(w.get("mullions", 0))
            for i in range(1, n + 1):
                frac = i / (n + 1)
                if axis == "x":
                    add_and_mat(coll, spec, (cx - width / 2 + width * frac, cy, zc), (0.045, FRAME_T + 0.01, height))
                else:
                    add_and_mat(coll, spec, (cx, cy - width / 2 + width * frac, zc), (FRAME_T + 0.01, 0.045, height))
    return coll


def add_and_mat(coll, spec, center, size):
    obj = linked_box("mullion", coll, center, size)
    assign(obj, material("frame", spec))
