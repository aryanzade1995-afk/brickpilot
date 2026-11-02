import unittest
from collections import Counter
from geometry.coastal_roof import roof_mesh

class ContinuousCoastalRoof(unittest.TestCase):
    def roof(self,regions):
        return {'bounds':{'x':0,'y':0,'w':10000,'h':12000},'regions':regions,'heightMm':3000,'thicknessMm':180,'pitchDeg':28,'elevationMm':6000}
    def check_mesh(self,roof,area):
        vertices,faces=roof_mesh(roof);half=len(vertices)//2
        edges=Counter(tuple(sorted((a,b))) for f in faces for a,b in zip(f,f[1:]+f[:1]))
        self.assertTrue(all(count==2 for count in edges.values()), 'Every roof edge must close; no broken panels')
        top=[f for f in faces if all(i<half for i in f)]
        measured=sum(abs(sum(vertices[a][0]*vertices[b][1]-vertices[b][0]*vertices[a][1] for a,b in zip(f,f[1:]+f[:1])))/2 for f in top)
        self.assertAlmostEqual(measured,area,places=2)
        self.assertTrue(all(6000<=v[2]<=9000.001 for v in vertices))
    def test_one_closed_hip_roof(self):
        self.check_mesh(self.roof([{'x':0,'y':0,'w':10000,'h':12000}]),120000000)
    def test_room_boundaries_do_not_create_independent_caps(self):
        self.check_mesh(self.roof([{'x':0,'y':0,'w':5000,'h':6000},{'x':5000,'y':0,'w':5000,'h':12000},{'x':0,'y':6000,'w':5000,'h':6000}]),120000000)
    def test_courtyard_void_stays_open(self):
        self.check_mesh(self.roof([{'x':0,'y':0,'w':3000,'h':12000},{'x':7000,'y':0,'w':3000,'h':12000},{'x':3000,'y':0,'w':4000,'h':4000},{'x':3000,'y':8000,'w':4000,'h':4000}]),104000000)
    def test_overlapping_source_regions_are_unioned_once(self):
        self.check_mesh(self.roof([{'x':0,'y':0,'w':10000,'h':12000},{'x':2000,'y':2000,'w':6000,'h':6000}]),120000000)

if __name__=='__main__':unittest.main()
