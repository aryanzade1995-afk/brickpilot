"""Run with Blender -b --python-exit-code 1 --python this_file."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry.safety import create_emergency_system

class Recorder:
    def __init__(self):
        self.materials={}
        self.names=[]
        self.plan_id='test-plan'
        self.collections={'SAFETY':bpy.data.collections.new('TestSafety')}
        bpy.context.scene.collection.children.link(self.collections['SAFETY'])
    def box(self,name,*args,**kwargs):
        self.names.append(name)
        return {}

scene=Recorder()
building={'floors':[{'id':'GF','level':0,'elevationMm':0}],
          'doors':[{'id':'main','kind':'entry','floorId':'GF'},
                   {'id':'emergency','kind':'door','floorId':'GF','emergencyExit':True,'width':900,'orient':'h','at':{'x':1000,'y':0}}],
          'emergency':{'markers':[
              {'id':'MAIN_EXIT','kind':'exit','level':0,'sourceId':'main'},
              {'id':'SIDE_EXIT','kind':'exit','level':0,'sourceId':'emergency'},
              {'id':'ALARM','kind':'alarm','level':0,'sourceId':'alarm','at':{'x':100,'y':100}},
              {'id':'EXTINGUISHER','kind':'extinguisher','level':0,'sourceId':'fire','at':{'x':200,'y':200}}]}}
before=set(bpy.data.curves.keys())
create_emergency_system(scene,building)
assert scene.names==['ALARM','EmergencyDoor_ReleaseBar'],scene.names
assert set(bpy.data.curves.keys())==before,'Exit lettering must not create any font geometry'
assert 'safety_exit' not in scene.materials
print('PASS: No EXIT plates or lettering on any door; alarms and door hardware remain.')

assert any(o.name.startswith('EXTINGUISHER_Detailed') and o.get('formstead_extinguisher_asset') for o in scene.collections['SAFETY'].objects)
for obj in scene.collections['SAFETY'].objects:
    for material in obj.data.materials:
        assert material.get('asset_pbr'), 'Packed extinguisher textures must survive GLB export'
from exporters.glb import export_glb
import tempfile, json, struct
with tempfile.TemporaryDirectory() as tmp:
    target=Path(tmp)/'safety.glb'
    export_glb(target)
    raw=target.read_bytes()
    data=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    body=next(m for m in data['materials'] if m['name']=='korean_fire_extinguisher_01_body')
    assert body['pbrMetallicRoughness'].get('baseColorTexture'), 'Red body texture was stripped from exported villa'
    assert body.get('normalTexture'), 'Detailed surface normals were stripped'
print('PASS: Extinguisher retains packed body colour and normal maps in villa GLB.')
