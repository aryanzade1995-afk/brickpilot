import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry.sizing import create_plinth_enclosure

class Scene:
    def __init__(self): self.parts=[]
    def rect(self,name,collection,r,z,h,material,source,bevel=0):
        part=dict(name=name,rect=r,z=z,h=h,material=material);self.parts.append(part);return part
    def box(self,name,collection,x,y,z,w,d,h,material,source,bevel=0):
        return self.rect(name,collection,dict(x=x-w/2,y=y-d/2,w=w,h=d),z,h,material,source,bevel)
    def plate_union(self,name,collection,rects,z,h,source):
        part=dict(name=name,rects=rects,z=z,h=h);self.parts.append(part);return part
    def assign_material(self,obj,material):obj['material']=material

class PlinthTests(unittest.TestCase):
    def test_encloses_to_selected_grade_with_earth_not_concrete(self):
        for height in [450,1000,1500]:
            floor=dict(id='GF',elevationMm=0,slabThicknessMm=180,footprint=[dict(x=0,y=0,w=6000,h=8000)])
            s=Scene();create_plinth_enclosure(s,dict(structuralSizing=dict(plinthHeightMm=height)),floor)
            self.assertEqual(len(s.parts),2)
            self.assertTrue(all(p['z']==-height-20 and p['z']+p['h']==-180 for p in s.parts))
            self.assertEqual(s.parts[0]['material'],'soil')
            self.assertTrue(all(p['material']!='concrete' for p in s.parts))
    def test_courtyard_is_not_filled(self):
        court=dict(x=2000,y=2000,w=2000,h=3000)
        floor=dict(id='GF',elevationMm=0,footprint=[dict(x=0,y=0,w=6000,h=8000)],courtyard=court)
        s=Scene();create_plinth_enclosure(s,{},floor)
        for p in s.parts:
            if p['material']!='soil':continue
            r=p['rect'];self.assertFalse(r['x']<3000<r['x']+r['w'] and r['y']<3000<r['y']+r['h'])

if __name__=='__main__':unittest.main(argv=[__file__])
