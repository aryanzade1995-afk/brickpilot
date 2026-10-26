"""Regression from the ground-only Blender library render."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'blender'))
from covered_validation import covered_support_name
class SupportIdentity(unittest.TestCase):
    def test_real_porch_and_envelope_posts_still_validated(self):
        for name in ('GF_parking_Roof_01_Post_01', 'GF_verandah_Roof_01_Post_04', 'EnvelopePier_exterior-pier-0', 'GF_parking_Roof_01_Post_01.001'):
            self.assertTrue(covered_support_name(name), name)
    def test_roof_stair_guard_and_window_posts_are_not_porch_pillars(self):
        for name in ('GF_Roof_StairGuard_1_Post_28600', 'GF_Roof_StairGuard_4_Post_5750', 'Grammar_Window_Asymmetric_03_Post_005', 'GF_Roof_Rail_Post_01'):
            self.assertFalse(covered_support_name(name), name)
if __name__ == '__main__': unittest.main()
