import unittest
from terrace_validation import validate_terrace

class CoastalRoofValidation(unittest.TestCase):
    def payload(self,character='coastal-bungalow',roof='hip',masses=None):
        return {'villaDesignDNA':{'character':character,'roofType':roof},'buildingModel':{},'massingModel':{'architectureLimits':{'minFreeTerraceRatio':.8},'masses':[{'usage':'roof'}] if masses is None else masses}}
    def test_coastal_hip_does_not_require_flat_terrace(self):
        self.assertIsNone(validate_terrace(self.payload()))
    def test_flat_roofs_still_require_authoritative_terrace(self):
        for character in ['coastal-bungalow','modern-box','tropical-beach-villa']:
            with self.subTest(character=character), self.assertRaisesRegex(ValueError,'authoritative usable terrace'):
                validate_terrace(self.payload(character,'flat-terrace'))
    def test_missing_pitched_roof_geometry_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'requires source roof volumes'):
            validate_terrace(self.payload(masses=[]))
    def test_unrelated_styles_do_not_bypass_terrace_validation(self):
        with self.assertRaisesRegex(ValueError,'authoritative usable terrace'):
            validate_terrace(self.payload('modern-box'))

if __name__=='__main__': unittest.main()
