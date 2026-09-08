"""
Geometry optimisation before export — keeps the GLB light and the viewer fast.

  - join every mesh in a collection into ONE object named after the collection
    (so the three.js viewer's layer toggles keep working), EXCEPT `Partitions`
    where per-room objects are kept for room interaction (tagged bp_room).
  - drop doubles, recalc normals
  - report the triangle count

Repeated elements (fins, mullions, stair treads, pergola slats, columns) are
already linked duplicates (shared mesh data) from their builders, so the join
is cheap and the pre-join scene is small.
"""

from __future__ import annotations

from .context import HAS_BPY

KEEP_SEPARATE = {"Partitions"}


def finalize(spec) -> dict:
    if not HAS_BPY:
        return {"objects": 0, "tris": 0}
    import bpy  # type: ignore

    stats = {"objects": 0, "tris": 0}

    for coll in list(bpy.data.collections):
        meshes = [o for o in coll.objects if o.type == "MESH"]
        if not meshes:
            continue

        if coll.name in KEEP_SEPARATE:
            for o in meshes:
                o["bp_room"] = o.name.replace("part-", "")
                _clean(o)
            stats["objects"] += len(meshes)
            continue

        # join into one
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = coll.name
        merged["bp_layer"] = coll.name
        _clean(merged)
        stats["objects"] += 1

    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            stats["tris"] += len(o.data.loop_triangles)

    # purge orphan meshes / materials
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    print(f"[optimize] {stats['objects']} objects, {stats['tris']} triangles  ({spec.style})")
    return stats


def _clean(obj) -> None:
    import bpy  # type: ignore
    import bmesh  # type: ignore

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")
