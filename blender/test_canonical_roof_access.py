import unittest
from unittest.mock import patch
import types,sys
sys.modules.setdefault('bpy',types.ModuleType('bpy'))
sys.modules.setdefault('bmesh',types.ModuleType('bmesh'))
from geometry.roof_services import create_roof_services

class Scene:
 def __init__(self):self.boxes=[]
 def box(self,*args):self.boxes.append(args)

class RoofAccessTest(unittest.TestCase):
 def test_enclosure_replays_canonical_door_and_solid_wall_spans(self):
  building={'floors':[{'id':'FF','level':1,'elevationMm':3100,'heightMm':3100}], 'stairs':[],
   'roofTerrace':{'mumty':{'x':0,'y':0,'w':3000,'h':4000},'tank':None}}
  access={'walls':[{'name':'Roof_Mumty_N_0','boundsMm':{'x':0,'y':-60,'z':6200,'w':1800,'d':120,'h':2200}}],
   'cap':{'x':0,'y':0,'z':8400,'w':3000,'d':4000,'h':120}}
  scene=Scene()
  with patch('geometry.openings.create_roof_exit_door') as door:
   create_roof_services(scene,building,access)
   door.assert_called_once_with(scene,access)
  self.assertEqual(len(scene.boxes),2,'no independently generated wide aperture')
  self.assertEqual(scene.boxes[0][0],'Roof_Mumty_N_0')
  self.assertEqual(scene.boxes[0][5:8],(1800,120,2200))

if __name__=='__main__':unittest.main(verbosity=2)
