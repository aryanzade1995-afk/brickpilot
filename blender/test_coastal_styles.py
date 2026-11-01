"""Style palette contracts; no Blender runtime or example rendering required."""
import unittest

from visualization.config import visualization_options
from visualization.palettes import palette_specs


class CoastalStyles(unittest.TestCase):
    def test_new_styles_have_distinct_defaults(self):
        for character, palette in (("coastal-bungalow", "COASTAL_BUNGALOW"),
                                   ("tropical-beach-villa", "TROPICAL_BEACH_VILLA")):
            result = visualization_options({"villaDesignDNA": {
                "character": character, "materialPalette": "kerala-laterite"}})
            self.assertEqual(result["palette"], palette)
        self.assertEqual(palette_specs("COASTAL_BUNGALOW")["roof"]["color"], "#A85A3C")

    def test_existing_and_explicit_palettes_are_preserved(self):
        payload = {"villaDesignDNA": {"character": "modern-box", "materialPalette": "warm-stone"}}
        self.assertEqual(visualization_options(payload)["palette"], "WHITE_STONE_WOOD")
        payload["villaDesignDNA"]["character"] = "coastal-bungalow"
        self.assertEqual(visualization_options(payload, {"palette": "earth"})["palette"], "SANDSTONE_PLASTER")
        self.assertNotIn("roof", palette_specs("warm-stone"))


if __name__ == "__main__":
    unittest.main()
