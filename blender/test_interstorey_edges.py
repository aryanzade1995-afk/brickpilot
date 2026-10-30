"""Regression for the open horizontal seam between centre-line floor plates."""
import sys
import types
import unittest

sys.modules.setdefault('bpy', types.ModuleType('bpy'))
sys.modules.setdefault('bmesh', types.ModuleType('bmesh'))
from geometry.plates import interstorey_edge_regions, subtract_rectangles
from geometry.structure import create_interstorey_edges, create_wall


class Scene:
    def __init__(self):
        self.boxes = []

    def rect(self, name, collection, rect, bottom, thickness, source_id=None, bevel=0):
        self.boxes.append((rect, bottom, thickness, source_id))

    def box(self, name, collection, x, y, bottom, width, depth, height, material, source_id, bevel=0):
        self.boxes.append(({'x':x-width/2, 'y':y-depth/2, 'w':width, 'h':depth}, bottom, height, source_id))


class InterstoreyEdges(unittest.TestCase):
    def setUp(self):
        self.lower = {'id':'GF', 'level':0, 'elevationMm':0, 'heightMm':3100, 'slabThicknessMm':150,
                      'footprint':[{'x':0,'y':0,'w':4000,'h':4000}]}
        self.upper = {**self.lower, 'id':'FF', 'level':1, 'elevationMm':3100, 'slabThicknessMm':125}
        self.wall = {'id':'wall', 'a':{'x':0,'y':0}, 'b':{'x':4000,'y':0}, 'thickness':230, 'kind':'exterior'}

    def test_outer_half_wall_is_filled_without_overlapping_floor_plates(self):
        regions = interstorey_edge_regions(self.lower, self.upper, [self.wall])
        self.assertEqual(regions, [{'x':0,'y':-115,'w':4000,'h':115}])
        self.assertEqual(interstorey_edge_regions(self.lower, self.upper, []), [])
        for r in regions:
            self.assertEqual(subtract_rectangles(r, self.lower['footprint']), [r])

    def test_wall_top_edge_and_receiving_slab_share_one_soffit(self):
        scene = Scene()
        create_wall(scene, self.wall, self.lower, [], 1, self.upper['slabThicknessMm'])
        wall_top = max(z+h for _, z, h, _ in scene.boxes)
        scene.boxes.clear()
        create_interstorey_edges(scene, self.lower, self.upper, [self.wall])
        self.assertEqual(wall_top, 2975)
        self.assertTrue(scene.boxes)
        for _, z, h, source in scene.boxes:
            self.assertEqual(z, wall_top)
            self.assertEqual(z+h, self.upper['elevationMm'])
            self.assertEqual(source, 'GF')

    def test_real_service_openings_remain_open(self):
        void = {'x':1000,'y':-200,'w':1000,'h':400}
        scene = Scene()
        create_interstorey_edges(scene, self.lower, self.upper, [self.wall], [void])
        self.assertEqual(len(scene.boxes), 2)
        self.assertTrue(all(not(r['x'] < 1500 < r['x']+r['w']) for r, *_ in scene.boxes))

    def test_stepped_upper_floor_and_disconnected_wings_are_not_bridged(self):
        self.lower['footprint'].append({'x':6000,'y':0,'w':2000,'h':4000})
        self.upper['footprint']=[{'x':1000,'y':1000,'w':2000,'h':2000}]
        other={**self.wall, 'a':{'x':6000,'y':0}, 'b':{'x':8000,'y':0}}
        regions=interstorey_edge_regions(self.lower,self.upper,[self.wall,other])
        self.assertEqual(sum(r['w']*r['h'] for r in regions), 6000*115)
        self.assertFalse(any(r['x'] < 5000 < r['x']+r['w'] for r in regions))


if __name__ == '__main__':
    unittest.main(verbosity=2)
