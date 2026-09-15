from alder.sapi import native_timings
from alder.speech import compare_transcript


def test_progress_overlap_keeps_each_source_word_once():
    events = [
        {'text':'took','start':29,'length':4,'seconds':0},
        {'text':'took A','start':29,'length':6,'seconds':.3},
        {'text':'watch','start':36,'length':5,'seconds':.5},
    ]
    words = native_timings(events, 1)
    assert [w['text'] for w in words] == ['took','A','watch']
    assert words[1]['startSeconds'] == .3
    assert compare_transcript('took A watch', ' '.join(w['text'] for w in words))['matched']


def test_duplicate_events_and_real_repeated_words_are_distinct():
    events = [
        {'text':'very','start':104,'length':4,'seconds':0},
        {'text':'very','start':104,'length':4,'seconds':.1},
        {'text':'very','start':109,'length':4,'seconds':.2},
        {'text':'clear','start':114,'length':5,'seconds':.4},
    ]
    words = native_timings(events, 1)
    assert [w['text'] for w in words] == ['very','very','clear']
    assert words[0]['endSeconds'] == .2
    assert not compare_transcript('very very clear', 'very clear')['matched']


def test_overlap_offsets_are_utf16_and_groups_have_separate_word_times():
    words = native_timings([
        {'text':'🙂','start':104,'length':2,'seconds':0},
        {'text':'🙂 A','start':104,'length':4,'seconds':.2},
        {'text':'long word','start':109,'length':9,'seconds':.4},
    ], 1)
    assert [w['text'] for w in words] == ['🙂','A','long','word']
    assert words[2]['endSeconds'] == words[3]['startSeconds'] == .7


def test_ssml_entity_counts_do_not_trim_unrelated_words():
    words = native_timings([
        {'text':'Zoë','start':104,'length':7,'seconds':0},
        {'text':'&','start':108,'length':5,'seconds':.2},
        {'text':'Alice','start':110,'length':9,'seconds':.4},
        {'text':'read','start':116,'length':8,'seconds':.6},
    ], 1)
    assert [w['text'] for w in words] == ['Zoë','&','Alice','read']


def test_native_fragments_of_one_number_merge_but_separate_numbers_do_not():
    words = native_timings([
        {'text':'18','start':20,'length':2,'seconds':0},
        {'text':'98','start':22,'length':2,'seconds':.2},
        {'text':'18','start':25,'length':2,'seconds':.4},
        {'text':'98','start':28,'length':2,'seconds':.6},
    ], 1)
    assert [w['text'] for w in words] == ['1898','18','98']
    assert words[0]['endSeconds'] == .4
