"""GLB / glTF export for the three.js viewer.

Y-up, materials exported, collection names kept as node extras so the viewer's
layer toggles keep working. Called by generator/house_generator.py.
"""

from __future__ import annotations

import os

try:
    import bpy  # type: ignore

    HAS_BPY = True
except Exception:  # pragma: no cover
    bpy = None  # type: ignore
    HAS_BPY = False


def export_glb(path: str) -> int:
    """write the current scene to `path`; returns byte size"""
    if not HAS_BPY:
        raise RuntimeError("export_glb requires Blender (bpy)")
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    for obj in bpy.data.objects:
        obj.select_set(obj.type == "MESH")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_draco_mesh_compression_enable=False,
    )
    return os.path.getsize(path)
