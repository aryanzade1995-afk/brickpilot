"""Geometry review only: run Blender on an exported .blend and pass -- output.png.
The editable master and GLB are unchanged. Uniform clay excludes palette effects.
"""
import sys
from pathlib import Path
import bpy

scene = bpy.context.scene
material = bpy.data.materials.new('ML_Review_White_Clay')
material.use_nodes = True
bsdf = material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (.8, .8, .8, 1)
bsdf.inputs['Roughness'].default_value = .8
scene.view_layers[0].material_override = material
# EEVEE does not consistently honour view-layer overrides for every exporter
# material. Assign the uniform shader in this unsaved review scene as well.
for mesh in bpy.data.meshes:
    mesh.materials.clear()
    mesh.materials.append(material)
scene.camera = bpy.data.objects['AerialCamera']
scene.render.resolution_x = 1024
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(Path(sys.argv[sys.argv.index('--')+1]).resolve())
bpy.ops.render.render(write_still=True)
