"""Use the same detailed fitting assets in Blender panoramas as the walkthrough."""
from pathlib import Path
import math
import json
import bpy

def attach_hardware(prefix, variant, position, outward, value, finish='chrome', basin_size=None):
    path=Path(__file__).resolve().parents[1]/'public/bath-hardware'/f'{prefix}-{max(0,min(4,variant))}.blend'
    if not path.exists():
        return False
    with bpy.data.libraries.load(str(path),link=False) as (source,target):
        target.objects=list(source.objects)
    angle=math.atan2(-outward[0],-outward[1])
    factor=1
    if basin_size and prefix=='basin-tap':
        record=next(a for a in json.loads((path.parent/'manifest.json').read_text()) if a['id']==path.stem)
        w,h,d=record['sizeM']
        factor=min(1,basin_size[0]*.72/w,basin_size[1]*.7/d,.18/h)
    colours={'chrome':(.50,.56,.62,1),'gold':(.49,.31,.10,1),'black':(.014,.017,.020,1)}
    materials={}
    for obj in target.objects:
        if obj is None or obj.type!='MESH':continue
        obj.name='Detailed_'+prefix+'_'+obj.name
        bpy.context.scene.collection.objects.link(obj)
        obj.rotation_euler.z=angle
        obj.scale=(factor,factor,factor)
        obj.location=(position[0],-position[2],position[1])
        for i,mat in enumerate(obj.data.materials):
            if mat.name.startswith('Selected fitting metal'):
                if mat.name not in materials:
                    m=mat.copy();node=m.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=colours[finish]
                    node.inputs['Roughness'].default_value=.30 if finish=='black' else .19
                    materials[mat.name]=m
                obj.data.materials[i]=materials[mat.name]
        obj['finish_item']='cp-fittings' if prefix=='basin-tap' else 'bath-shower'
        obj['finish_name']=value.get('name','')
        obj['finish_variant']=variant
    return True
