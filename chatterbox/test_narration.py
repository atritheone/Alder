import unittest
from narration import split_narration


class NarrationSplittingTests(unittest.TestCase):
    def assert_preserved(self, text):
        chunks = split_narration(text)
        self.assertEqual(" ".join(chunks).split(), text.split())
        self.assertTrue(all(0 < len(c) <= 240 and len(c.split()) <= 45 for c in chunks))
        return chunks

    def test_wrapped_and_quoted_prose(self):
        text = ('Mr. Smith said, “This is a test.”\nThe value was 3.14, and it mattered. ' * 10)
        self.assert_preserved(text)

    def test_long_sentence_without_punctuation(self):
        self.assert_preserved("word " * 300)

    def test_sentence_boundary_and_paragraphs(self):
        first = "The first sentence is complete."
        second = "The second sentence follows."
        self.assertEqual(split_narration(first + " " + second, max_chars=40), [first, second])
        self.assertEqual(split_narration(first + "\n\n" + second), [first, second])

    def test_empty_and_unbroken_token(self):
        self.assertEqual(split_narration(" \n "), [])
        with self.assertRaises(ValueError):
            split_narration("x" * 241)


if __name__ == "__main__":
    unittest.main()
