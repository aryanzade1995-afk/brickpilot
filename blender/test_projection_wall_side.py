import unittest
from specialized_validation import wall_side

class ProjectionWallSideTest(unittest.TestCase):
    def test_shared_cell_boundary_is_not_a_facade_void(self):
        building = {'floors': [{'id':'FF','footprint':[
            {'x':1000,'y':0,'w':3000,'h':1500},
            {'x':1000,'y':1500,'w':3000,'h':1500}]}]}
        wall = {'id':'west','floorId':'FF','a':{'x':1000,'y':0},'b':{'x':1000,'y':3000}}
        self.assertEqual(wall_side(building,wall),'W')
        wall['a']['x']=wall['b']['x']=2500
        with self.assertRaises(ValueError):
            wall_side(building,wall)

if __name__ == '__main__':
    unittest.main()
