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
assert scene.names==['ALARM','EXTINGUISHER','EmergencyDoor_ReleaseBar'],scene.names
assert set(bpy.data.curves.keys())==before,'Exit lettering must not create any font geometry'
assert 'safety_exit' not in scene.materials
print('PASS: No EXIT plates or lettering on any door; alarms and door hardware remain.')
