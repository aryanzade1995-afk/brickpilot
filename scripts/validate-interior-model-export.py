"""Verify the actual Blender delivery adapter against canonical live instances."""
import bpy,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'blender'))
from walkthrough_export import root as scene_root,add_interior_models
from exporters.glb import export_glb
app=json.loads((root/'output/furniture-sources/appearance.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
parent=scene_root('interior-pack-test','walkthrough-furniture')
replaced=add_interior_models(app['models'],parent)
assert replaced and len([o for o in bpy.context.scene.objects if o.get('instanceId')])==len(app['models'])
export_glb(root/'output/furniture-sources/models.glb')
print('CANONICAL_MODELS_EXPORTED',len(app['models']),flush=True)
