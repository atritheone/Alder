from alder.reading import word_timings
from alder.speech_quality import valid_timings


def timed(text, start, end):
    return dict(text=text, startSeconds=start, endSeconds=end)


def test_unknown_word_uses_recognized_interval_without_changing_source():
    text = "The thebaine dissolved"
    result = word_timings(text, text, [timed("The", 0, .2), timed("the bane", .2, .9), timed("dissolved", .9, 1.5)], seconds=1.5)
    assert [w["text"] for w in result] == text.split()
    assert result[1]["startSeconds"] == .2 and result[1]["endSeconds"] == .9
    assert result[1]["estimated"]
    assert valid_timings(result, text, 1.5) == result


def test_missing_leading_middle_and_trailing_words_remain_individual():
    for text, words in [
        ("rare word", [timed("word", 0, 1)]),
        ("one rare word", [timed("one", 0, .4), timed("word", .4, 1)]),
        ("one rare", [timed("one", 0, 1)]),
    ]:
        result = word_timings(text, text, words, seconds=1)
        assert [w["text"] for w in result] == text.split()
        assert valid_timings(result, text, 1) == result
        assert any(w["estimated"] for w in result)


def test_combined_native_event_does_not_drop_later_words():
    text = "can not go"
    result = word_timings(text, text, [timed("cannot", 0, .5), timed("go", .5, 1)], seconds=1)
    assert [w["text"] for w in result] == text.split()
    assert valid_timings(result, text, 1) == result


def test_missing_recognition_uses_explicit_duration_estimates():
    text = "Unfamiliar terminology"
    result = word_timings(text, text, [], seconds=2)
    assert [w["text"] for w in result] == text.split()
    assert all(w["estimated"] for w in result)
    assert result[0]["startSeconds"] == 0 and result[-1]["endSeconds"] == 2
    assert word_timings(text, text, []) == []


def test_phrase_pronunciation_highlights_each_authored_word():
    result = word_timings("Dr Alder", "Doctor Alder", [timed("Doctor", 0, .5), timed("Alder", .5, 1)],
                          [dict(sourceStart=0, sourceEnd=8, spokenStart=0, spokenEnd=12)], seconds=1)
    assert [w["text"] for w in result] == ["Dr", "Alder"]
    assert valid_timings(result, "Dr Alder", 1) == result
