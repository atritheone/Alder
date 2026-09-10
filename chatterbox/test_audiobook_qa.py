import unittest
from audiobook_qa import compare


class SpeechVerificationTests(unittest.TestCase):
    def test_spelling_and_number_variants(self):
        self.assertTrue(compare("Book 2. Her Art.", "Book two, her art.")["accepted"])
        self.assertTrue(compare("Her judgement is recognisable.", "Her judgment is recognizable.")["accepted"])

    def test_rejects_missing_repeated_changed_or_reordered_words(self):
        expected = "I am not created by His recognition."
        for heard in ["I am created by His recognition.", "I am not not created by His recognition.",
                      "I am not destroyed by His recognition.", "His recognition am not created by I.", ""]:
            self.assertFalse(compare(expected, heard)["accepted"], heard)

    def test_known_homophones_do_not_enable_arbitrary_substitutions(self):
        self.assertTrue(compare("The I of which I speak", "The eye of which I speak")["accepted"])
        self.assertFalse(compare("Patience is needed", "A patient is needed")["accepted"])


if __name__ == "__main__":
    unittest.main()
