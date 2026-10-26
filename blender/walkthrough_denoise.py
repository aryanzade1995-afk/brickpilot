"""Explicit OpenImageDenoise compositor pass for linear irradiance atlases."""
import bpy
from pathlib import Path

def denoise_atlases(out,atlases):
    original=bpy.context.window.scene
    scene=bpy.data.scenes.new('Lightmap denoise only')
    bpy.context.window.scene=scene
    scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False
    scene.world=bpy.data.worlds.new('Empty denoise world');scene.world.color=(0,0,0)
    camera_data=bpy.data.cameras.new('Denoise camera');camera=bpy.data.objects.new('Denoise camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
    scene.render.image_settings.file_format='HDR';scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.use_nodes=True;tree=scene.node_tree;tree.nodes.clear()
    image_node=tree.nodes.new('CompositorNodeImage');denoise=tree.nodes.new('CompositorNodeDenoise');denoise.use_hdr=True;denoise.prefilter='ACCURATE'
    output=tree.nodes.new('CompositorNodeComposite');tree.links.new(image_node.outputs['Image'],denoise.inputs['Image']);tree.links.new(denoise.outputs['Image'],output.inputs['Image'])
    try:
      for atlas in atlases:
        image=bpy.data.images.load(str(Path(out)/atlas['irradiance']),check_existing=False);image.colorspace_settings.name='Linear Rec.709';image_node.image=image
        scene.render.resolution_x=atlas['width'];scene.render.resolution_y=atlas['height'];scene.render.resolution_percentage=100
        # The empty scene renders only a blank layer; the compositor consumes
        # the full-resolution linear image. No house is rendered again.
        scene.render.filepath=str(Path(out)/atlas['irradiance']);bpy.ops.render.render(write_still=True,scene=scene.name)
        image_node.image=None;bpy.data.images.remove(image)
    finally:
      bpy.context.window.scene=original;bpy.data.scenes.remove(scene)

if __name__=='__main__':
    import json,sys
    folder=Path(sys.argv[sys.argv.index('--')+1]);manifest=json.loads((folder/'manifest.json').read_text())
    denoise_atlases(folder,manifest['atlases'])
