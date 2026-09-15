from pathlib import Path
import pytest
from alder.pronunciation import import_rex, export_rex, sequential_projection, validate_rule
from alder.speech import pronunciation_projection
from alder.speech_quality import projected_sections


def dictionary(text):
    parsed=import_rex(text.encode('utf-8'),'test.rex')
    assert parsed['errors']==[]
    return parsed['rules']


def test_boundaries_case_and_unrestricted_matches():
    rules=dictionary(r"\b(aged)\b=age-id"+'\n'+r"@(Alam)\b=Ah-lum"+'\n'+r"cat=kat")
    assert [r['matchMode'] for r in rules]==['whole','end','anywhere']
    assert rules[1]['caseSensitive']
    text='aged unaged agedly AGED Alam alam xAlam Alamx cat scatter'
    spoken,maps=pronunciation_projection(text,rules)
    assert spoken=='age-id unaged agedly age-id Ah-lum alam xAh-lum Alamx kat skatter'
    assert all(text[m['sourceStart']:m['sourceEnd']]==m['word'] and spoken[m['spokenStart']:m['spokenEnd']]==m['spoken'] for m in maps)


def test_order_is_cascading_and_source_spans_survive():
    rules=dictionary('rat=mouse\nmouse=hamster')
    result,maps=pronunciation_projection('A rat and mouse.',rules)
    assert result=='A hamster and hamster.'
    assert [m['word'] for m in maps]==['rat','mouse']
    assert [m['spoken'] for m in maps]==['hamster','hamster']
    assert pronunciation_projection('rat',list(reversed(rules)))[0]=='mouse'


def test_captures_case_conversion_and_escaped_separator():
    rules=dictionary(r'@\b([A-Z]+)-(\d+)\b=\L$1\E number $2'+'\n'+r'x\=y=equals'+'\n'+r'(wow)=\u$1')
    assert pronunciation_projection('ABC-12 x=y wow',rules)[0]=='abc number 12 equals Wow'
    again=dictionary(export_rex(rules).decode('utf-8-sig'))
    assert pronunciation_projection('ABC-12 x=y wow',again)[0]=='abc number 12 equals Wow'


def test_empty_replacement_unicode_and_enabled_voice_scope():
    rules=dictionary('omit=\nname=voice')
    rules[1]['voiceId']='selected'
    text='🌲 omit name café'
    spoken,maps=pronunciation_projection(text,rules,'default')
    assert spoken=='🌲  name café'
    assert maps[0]['word']=='omit' and maps[0]['spoken']==''
    assert pronunciation_projection(text,rules,'selected')[0]=='🌲  voice café'
    rules[0]['enabled']=False
    assert pronunciation_projection(text,rules)[0]==text


def test_malformed_dictionary_reports_line_without_hiding_valid_rules():
    parsed=import_rex(b'# comment\nword=sound\ninvalid\n(=broken','sample.rex')
    assert len(parsed['rules'])==1
    assert [e['line'] for e in parsed['errors']]==[3,4]


@pytest.mark.parametrize('pattern,text,expected',[(r'\b(cat|dog)s?\b','cats dog','pet pet'),(r'\b[0-9]{2,3}\b','1 12 123 1234','1 pet pet 1234'),(r'(.)\1','book','bpetk'),(r'\x{00dc}','Ü','pet'),(r'(?<\=a)b','ab cb','apet cb')])
def test_pattern_builder_round_trip(pattern,text,expected):
    rules=dictionary(pattern+'=pet')
    assert pronunciation_projection(text,rules)[0]==expected
    assert pronunciation_projection(text,dictionary(export_rex(rules).decode('utf-8-sig')))[0]==expected


def test_substitutions_keep_original_positions_after_partial_cascade():
    rules=dictionary('abc=defghi\nef=XY\nghi=Z')
    spoken,maps=pronunciation_projection('abc end',rules)
    assert spoken=='dXYZ end'
    assert maps==[{'sourceStart':0,'sourceEnd':3,'spokenStart':0,'spokenEnd':4,'word':'abc','spoken':'dXYZ'}]


def test_projected_sections_use_rex_for_both_speech_engines():
    rules=dictionary(r'\b(aged)\b=age-id')
    for voice in ['default','sapi-example']:
        parts=projected_sections('An aged tree.',rules,voice)
        assert parts[0]['spokenText']=='An age-id tree.'
        assert parts[0]['pronunciationMap'][0]['sourceStart']==3


def test_invalid_capture_and_costly_regex_are_rejected():
    rule=dictionary('(word)=$1')[0]
    rule['replacementParts'][0]['group']=2
    with pytest.raises(ValueError,match='captured'):validate_rule(rule)
    rule=dictionary('(a+)+$=bad')[0]
    with pytest.raises(ValueError,match='too long'):
        sequential_projection('a'*10000+'!', [rule], 'default')


def test_disabled_rules_and_voice_assignments_survive_rex_round_trip():
    rules=dictionary('word=sound')
    rules[0].update(enabled=False,voiceId='voice-123')
    copy=dictionary(export_rex(rules).decode('utf-8-sig'))
    assert not copy[0]['enabled'] and copy[0]['voiceId']=='voice-123'
    assert copy[0]['word']=='word' and copy[0]['spoken']=='sound'


def test_omitted_passages_do_not_create_empty_synthesis_jobs():
    assert projected_sections('omit. Keep this.',dictionary('omit.=\n'),'default')[0]['spokenText']=='Keep this.'


def test_character_exclusions_and_octal_escapes_round_trip():
    rules=dictionary(r'[^a-z0-9]=other')
    assert pronunciation_projection('az1!',rules)[0]=='az1other'
    assert pronunciation_projection('az1!',dictionary(export_rex(rules).decode('utf-8-sig')))[0]=='az1other'
    assert pronunciation_projection('a\tb',dictionary(r'\11=space'))[0]=='aspaceb'


def test_checker_accepts_dictionary_spellings_only_in_exact_context():
    from alder.pronunciation import compare_pronounced
    part=projected_sections('An aged simulation worked well.',dictionary('aged=age-id\nsimulation=Sim-mewlation'),'default')[0]
    for text in ['An aged simulation worked well.', 'An age id simulation worked well.', 'An aged sim mewlation worked well.']:
        assert compare_pronounced(part,text)['matched']
    for text in ['An aged simulation failed badly.', 'An aged simulation worked.', 'An aged tree worked well.', 'An aged simulation worked well well.']:
        assert not compare_pronounced(part,text)['matched']
    omitted=projected_sections('omit this word.',dictionary('omit=gone'),'default')[0]
    assert not compare_pronounced(omitted,'this word')['matched']
