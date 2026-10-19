"""Run with Blender -b --python-exit-code 1 --python this_file."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry.roof_regions import roof_components, roof_has_access
from geometry.covered import create_exposed_roofs


class SceneRecorder:
    def __init__(self):
        self.rects, self.boxes, self.box_data = [], [], []
    def rect(self, name, collection, rect, bottom, thickness, material='concrete', source_id=None, **kwargs):
        self.rects.append((name, rect, material))
    def box(self, name, *args, **kwargs):
        self.boxes.append(name)
        self.box_data.append((name, args))


class SetbackTests(unittest.TestCase):
    def setback_scene(self, width):
        lower={'id':'GF','level':0,'elevationMm':0,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':width,'h':6000}]}
        upper={'id':'FF','level':1,'elevationMm':3100,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':7000,'h':6000}]}
        room={'floorId':'FF','outdoor':True,'id':'balcony1','semanticId':'FF_BALCONY','rect':{'x':7000,'y':300,'w':2700,'h':5400}}
        door={'floorId':'FF','kind':'door','orient':'v','at':{'x':7000,'y':3000},'width':1800,'rooms':['bed3','balcony1']}
        scene=SceneRecorder()
        create_exposed_roofs(scene,{'floors':[lower,upper],'rooms':[room],'doors':[door]})
        return scene

    def test_narrow_roof_lip_does_not_add_second_parapet_outside_balcony_guard(self):
        scene=self.setback_scene(10000)
        self.assertFalse(scene.boxes, 'The balcony already guards this entire setback roof; no outer parapet')

    def test_500_and_600_mm_lips_do_not_create_parallel_outer_walls_or_guards(self):
        for width in (10200, 10300):
            scene=self.setback_scene(width)
            self.assertFalse(scene.boxes, 'The inner glass guard already protects this inaccessible roof lip')

    def test_source_balcony_does_not_get_a_second_outer_wall_or_glass_boundary(self):
        scene=self.setback_scene(14000)
        self.assertFalse(scene.boxes, 'Source balcony already encloses the only accessible outdoor area')

    def test_roofs_without_balcony_access_keep_their_solid_parapet(self):
        lower={'id':'GF','level':0,'elevationMm':0,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':10000,'h':6000}]}
        upper={'id':'FF','level':1,'elevationMm':3100,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':7000,'h':6000}]}
        scene=SceneRecorder()
        create_exposed_roofs(scene,{'floors':[lower,upper],'rooms':[],'doors':[]})
        self.assertTrue(any('_Parapet_' in name for name in scene.boxes))

    def test_a_separate_roof_door_retains_an_outer_glass_guard(self):
        lower={'id':'GF','level':0,'elevationMm':0,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':14000,'h':6000}]}
        upper={'id':'FF','level':1,'elevationMm':3100,'heightMm':3100,'footprint':[{'x':0,'y':0,'w':7000,'h':6000}]}
        room={'floorId':'FF','outdoor':True,'id':'balcony1','semanticId':'FF_BALCONY','rect':{'x':7000,'y':2000,'w':2700,'h':2000}}
        doors=[{'floorId':'FF','kind':'door','orient':'v','at':{'x':7000,'y':3000},'width':900,'rooms':['bed3','balcony1']},
               {'floorId':'FF','kind':'door','orient':'v','at':{'x':7000,'y':800},'width':900,'rooms':['lobby',None]}]
        scene=SceneRecorder()
        create_exposed_roofs(scene,{'floors':[lower,upper],'rooms':[room],'doors':doors})
        self.assertTrue(any('_GlassGuard_' in name for name in scene.boxes))
        self.assertFalse(any('_Parapet_' in name for name in scene.boxes))

    def test_disconnected_and_corner_touching_roofs_are_separate(self):
        a={'x':0,'y':0,'w':3000,'h':3000}
        b={'x':3000,'y':3000,'w':3000,'h':3000}
        self.assertEqual(len(roof_components([a,b])),2)
        b['y']=2000
        self.assertEqual(len(roof_components([a,b])),1)

    def test_access_checks_the_whole_door_and_joins_partition_seams(self):
        pieces=[{'x':0,'y':0,'w':1500,'h':3000},{'x':1500,'y':0,'w':1500,'h':3000}]
        door={'floorId':'FF','kind':'door','orient':'h','at':{'x':1500,'y':0},'width':900}
        self.assertTrue(roof_has_access(pieces,[door],'FF'))
        door['at']['y']=400
        self.assertFalse(roof_has_access(pieces,[door],'FF'))
        door['at']={'x':100,'y':0}
        self.assertFalse(roof_has_access(pieces,[door],'FF'))

    def test_only_source_outdoor_area_is_paved_and_its_slab_is_not_duplicated(self):
        lower={'id':'GF','level':0,'elevationMm':0,'heightMm':3000,'footprint':[{'x':0,'y':0,'w':10000,'h':6000}]}
        upper={'id':'FF','level':1,'elevationMm':3000,'heightMm':3000,'footprint':[{'x':3000,'y':0,'w':4000,'h':6000}]}
        room={'floorId':'FF','outdoor':True,'id':'balcony1','semanticId':'FF_BALCONY1','rect':{'x':7000,'y':1500,'w':2400,'h':3000}}
        door={'floorId':'FF','kind':'door','orient':'v','at':{'x':7000,'y':3000},'width':900,'rooms':['lobby1','balcony1']}
        scene=SceneRecorder()
        result=create_exposed_roofs(scene,{'floors':[lower,upper],'rooms':[room],'doors':[door]})
        self.assertEqual(result['terraces'],1)
        deck=[r for name,r,_mat in scene.rects if '_Deck_' in name]
        self.assertTrue(deck)
        self.assertTrue(all(r['x']>=7000 and r['x']+r['w']<=9400 for r in deck))
        for name,r,_mat in scene.rects:
            if '_Slab_' not in name:
                continue
            b=room['rect']
            overlap=max(0,min(r['x']+r['w'],b['x']+b['w'])-max(r['x'],b['x']))*max(0,min(r['y']+r['h'],b['y']+b['h'])-max(r['y'],b['y']))
            self.assertEqual(overlap,0)
        self.assertFalse(any('_R2_GlassGuard_' in name for name in scene.boxes), 'No second row of glass outside the source balcony')
        self.assertFalse(any('_R2_Parapet_' in name for name in scene.boxes))
        self.assertTrue(any('_R1_Parapet_' in name for name in scene.boxes), 'Separate roof without access keeps its solid parapet')


result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SetbackTests))
if not result.wasSuccessful():
    raise RuntimeError('Setback terrace regression')
