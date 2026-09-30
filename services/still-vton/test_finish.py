import unittest

from finish import corner_background_mask, face_box, fashn_category
import server


class FinishTests(unittest.TestCase):
    def test_categories(self) -> None:
        self.assertEqual(fashn_category("TOP"), "tops")
        self.assertEqual(fashn_category("LOWER_BODY"), "bottoms")
        self.assertEqual(fashn_category("FULL_BODY"), "one-pieces")
        self.assertIsNone(fashn_category("HAT"))
        self.assertIsNone(fashn_category(None))

    def test_face_box_stays_in_frame(self) -> None:
        box = face_box(480, 720)
        self.assertIsNotNone(box)
        assert box is not None
        x, y, w, h = box
        self.assertGreaterEqual(x, 0)
        self.assertGreaterEqual(y, 0)
        self.assertLess(x + w, 480)
        self.assertLessEqual(y + h, 720)
        self.assertIsNone(face_box(32, 32))

    def test_corner_mask_keeps_the_center(self) -> None:
        width, height = 20, 20
        pixels = [(240, 240, 240)] * (width * height)
        for y in range(6, 15):
            for x in range(6, 15):
                pixels[y * width + x] = (20, 40, 180)
        mask = corner_background_mask(pixels, width, height)
        self.assertIsNotNone(mask)
        assert mask is not None
        self.assertTrue(mask[0])
        self.assertFalse(mask[10 * width + 10])

    def test_unreliable_mask_is_refused(self) -> None:
        pixels = [(10, 10, 10)] * 64
        self.assertIsNone(corner_background_mask(pixels, 8, 8))

    def test_missing_weights_are_not_ready(self) -> None:
        self.assertFalse(server.weights_ready(None))
        self.assertFalse(server.weights_ready("/tmp/does-not-exist-mirrorfit"))


if __name__ == "__main__":
    unittest.main()
