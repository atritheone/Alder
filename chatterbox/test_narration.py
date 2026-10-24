import unittest
from narration import (split_narration, sentence_sections, validate_section_breaks,
                       SentenceTooLongError, preflight_tracks)


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
        text = "word " * 300
        with self.assertRaises(SentenceTooLongError) as raised:
            split_narration(text)
        self.assertEqual(raised.exception.sentences, [text.strip()])

    def test_sentence_boundary_and_paragraphs(self):
        first = "The first sentence is complete."
        second = "The second sentence follows."
        self.assertEqual(split_narration(first + " " + second, max_chars=40), [first, second])
        self.assertEqual(split_narration(first + "\n\n" + second), [first, second])

    def test_empty_and_unbroken_token(self):
        self.assertEqual(split_narration(" \n "), [])
        with self.assertRaises(ValueError):
            split_narration("x" * 241)

    def test_single_sentence_stays_whole_despite_small_repair_target(self):
        text = 'Dr. Smith went down to the river, where he waited; then he returned home.'
        self.assertEqual(split_narration(text, max_chars=25, max_words=4), [text])

    def test_size_targets_cannot_override_safety_caps(self):
        text = 'a ' * 45 + 'a.'
        with self.assertRaises(SentenceTooLongError):
            split_narration(text, max_chars=9999, max_words=9999)
        self.assert_preserved('A short complete sentence. ' * 50)

    def test_initials_abbreviations_decimals_and_names(self):
        text = 'Dr. J. R. Smith, Ph.D., paid 3.14 pounds to Mr. Jones at 5 p.m. yesterday.'
        self.assertEqual(split_narration(text, max_chars=12), [text])
        self.assertEqual(sentence_sections('He met J. R. Smith. They went home.'),
                         ['He met J. R. Smith.', 'They went home.'])

    def test_dialogue_attribution_and_parentheses(self):
        for text in ['“Stop!” she said.', '“Stop!” John said.',
                     '"Stop!" she said.', 'She waited (was it safe? Yes) before leaving.',
                     '“One sentence. Another sentence,” she said.']:
            self.assertEqual(split_narration(text, max_chars=5), [text])

    def test_quoted_sentence_can_end_a_section(self):
        text = 'She said, “It is ready.” He left.'
        self.assertEqual(split_narration(text, max_chars=15),
                         ['She said, “It is ready.”', 'He left.'])

    def test_paragraph_break_cannot_cut_an_unfinished_sentence(self):
        text = 'He walked to the river\n\nwhere the boat waited.'
        self.assertEqual(split_narration(text, max_chars=10),
                         ['He walked to the river where the boat waited.'])

    def test_list_numbers_and_ellipses_remain_with_context(self):
        for text in ['1. First item; 2. Second item.', 'He waited... Then continued.',
                     'Chapter IV. The journey begins.']:
            self.assertEqual(split_narration(text, max_chars=5), [text])

    def test_titles_and_unicode_words_are_preserved(self):
        self.assertEqual(split_narration('Book 1 - Herself'), ['Book 1 - Herself'])
        self.assert_preserved('The Goddess’s secret was known to Amè. “Go,” she said.')

    def test_cached_clause_cuts_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'mid-sentence'):
            validate_section_breaks('He walked home, and waited.', ['He walked home,', 'and waited.'])
        validate_section_breaks('He walked home. Then he waited.', ['He walked home.', 'Then he waited.'])

    def test_preflight_collects_all_overlong_sentences(self):
        long = 'word ' * 50 + 'ended.'
        tracks = [{'track': 1, 'paragraphs': [long, 'A short sentence.']},
                  {'track': 2, 'blocks': [{'text': long}]}]
        findings = preflight_tracks(tracks)
        self.assertEqual([f['track'] for f in findings], [1, 2])
        self.assertTrue(all(f['text'] == long for f in findings))

    def test_long_sentences_split_only_at_clause_punctuation(self):
        for punctuation in [',', ':', ';', ' —', ' –', ' -']:
            clause=' '.join(['word']*25)+punctuation
            text=f'{clause} {clause} Then the sentence ends.'
            pieces=self.assert_preserved(text)
            self.assertGreater(len(pieces),1)
            self.assertTrue(all(p.endswith(punctuation) for p in pieces[:-1]), pieces)
            validate_section_breaks(text,pieces)
            self.assertEqual(preflight_tracks([{'track':1,'paragraphs':[text]}]),[])

    def test_no_breaks_at_numeric_separators_or_hyphenated_names(self):
        text=('He carried 1,000 pounds at 10:30 past Shway-Loht-Gyee ' * 8)+ 'and stopped.'
        with self.assertRaises(SentenceTooLongError):
            split_narration(text)

    def test_long_unbroken_clause_is_still_flagged(self):
        text='Opening clause, '+ 'word '*60 + 'ended.'
        with self.assertRaises(SentenceTooLongError):
            split_narration(text)

    def test_nonpositive_targets_are_rejected(self):
        for limits in [{'max_chars': 0}, {'max_words': 0}]:
            with self.assertRaises(ValueError):
                split_narration('A sentence.', **limits)


if __name__ == "__main__":
    unittest.main()
