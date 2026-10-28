"""Extract only the canopy skins from Kenney's CC0 awnings; keep UV/materials.
Run with the existing Blender executable, not at application runtime.
"""
import bpy, bmesh, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for name in ('detail-awning', 'detail-awning-wide'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'output', 'kenney-city-shades', 'Models', 'GLB format', name+'.glb'))
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bm=bmesh.new(); bm.from_mesh(obj.data)
        heights=[(obj.matrix_world @ v.co).z for v in bm.verts]
        threshold=min(heights)+(max(heights)-min(heights))*.75
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if (obj.matrix_world @ v.co).z<threshold], context='VERTS')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    bpy.ops.export_scene.gltf(filepath=os.path.join(root,'public','exterior-assets','kenney-shades',name+'.glb'), export_format='GLB', export_yup=True)
