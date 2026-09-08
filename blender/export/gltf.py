"""GLB / glTF export for the three.js viewer."""

from __future__ import annotations

import os

try:
    import bpy  # type: ignore

    HAS_BPY = True
except Exception:  # pragma: no cover
    bpy = None  # type: ignore
    HAS_BPY = False


def export_glb(path: str) -> None:
    if not HAS_BPY:
        raise RuntimeError("export_glb requires Blender (bpy)")
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    # select everything so the exporter picks it all up
    for obj in bpy.data.objects:
        obj.select_set(obj.type == "MESH")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,  # three.js is Y-up
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,  # keep collection names -> viewer layer toggles
    )
