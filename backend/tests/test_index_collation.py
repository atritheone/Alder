from pathlib import Path
import pytest
from alder.document_index import groups, index_instruction, read_index_instruction
from alder.document_contents import refresh_contents
from alder.index_collation import validate_language, word_language
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document


def fixture():
    p = create_project(template='blank'); p['name'] = 'Index languages'; p['language'] = 'sv-SE'
    p['settings'].update(documentKind='docx', includeTitle=False, pageSize='A4')
    markers = [{'type': 'index_entry', 'attrs': {'blockId': f'entry{i}', 'terms': terms}}
               for i, terms in enumerate([['Örebro'], ['Aachen'], ['Åland'], ['Zebra'], ['Älmhult'],
                                          ['Places', 'Örebro'], ['Places', 'Zebra'], ['Places', 'Åland']])]
    blocks = [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'The source remains unchanged.'}, *markers]}]
    for lang in ('sv-SE', 'en-US'):
        blocks.append({'type': 'table_of_contents', 'attrs': {'kind': 'index', 'title': lang, 'depth': 3, 'indexLanguage': lang}, 'content': [{'type': 'paragraph'}]})
    p['book'] = {'version': 1, 'chapters': [{'id': 'main', 'title': 'Text', 'include': True, 'document': {'type': 'doc', 'content': blocks}}]}
    return validate_project(p)


def test_language_hierarchy_sort_text_and_equivalent_unicode():
    terms = ['Örebro', 'Aachen', 'Åland', 'Zebra', 'Älmhult']
    sources = [{'blockId': str(i), 'terms': [t]} for i, t in enumerate(terms)]
    order = lambda lang: [g['terms'][0] for g in groups(sources, language=lang)]
    assert order('sv-SE') == ['Aachen', 'Zebra', 'Åland', 'Älmhult', 'Örebro']
    assert order('en-US') == ['Aachen', 'Åland', 'Älmhult', 'Örebro', 'Zebra']
    nested = [{**s, 'terms': ['Places', s['terms'][0]]} for s in sources]
    assert [g['terms'][-1] for g in groups(nested, language='sv-SE')][1:] == order('sv-SE')
    sources[0]['sortTerms'] = ['Before']
    assert [g['terms'][0] for g in groups(sources, language='sv-SE')][:3] == ['Aachen', 'Örebro', 'Zebra']
    equivalent = [{'blockId': 'a', 'terms': ['é']}, {'blockId': 'b', 'terms': ['e\u0301']}]
    assert [g['ids'] for g in groups(equivalent, language='fr-FR')] == [['b'], ['a']]
    with pytest.raises(ValueError, match='unavailable'): groups(sources, language='zz-ZZ')


@pytest.mark.parametrize('format', ['docx', 'html', 'epub'])
def test_localized_index_exchange_and_refresh(tmp_path, format):
    p = fixture(); doc = p['book']['chapters'][0]['document']; refresh_contents([doc])
    before = [document_text(n) for n in doc['content'][1:]]
    doc['content'][1]['content'][1]['attrs']['fontSize'] = 17
    refresh_contents([doc]); assert doc['content'][1]['content'][1]['attrs']['fontSize'] == 17
    result = build_export(p, format, tmp_path)
    restored = import_document(Path(result['path']))['document']
    indexes = [n for n in restored['content'] if n['type'] == 'table_of_contents']
    assert [n['attrs']['indexLanguage'].lower() for n in indexes] == ['sv-se', 'en-us']
    # PDF/page numbers are refreshed independently; compare the term hierarchy.
    assert [[c['attrs']['terms'] for row in n['content'] for c in row.get('content', []) if c['type'] == 'index_reference'] for n in indexes] == [[c['attrs']['terms'] for row in n['content'] for c in row.get('content', []) if c['type'] == 'index_reference'] for n in doc['content'][1:]]
    assert before[0] != before[1]


def test_word_language_switch_is_explicit_and_bounded():
    assert word_language('sv') == 1053
    assert word_language('en-GB') == 2057
    for tag in ('sv-SE', 'en-US', 'tr-TR', 'ja-JP'):
        assert read_index_instruction(index_instruction({'indexLanguage': tag}))['indexLanguage'].lower() == tag.lower()
    assert read_index_instruction(' INDEX \\z "sv-SE" ')['indexLanguage'] == 'sv-SE'
    for tag in ('sv;evil', '', 'en_US', 'a' * 41):
        with pytest.raises(ValueError): validate_language(tag)
    with pytest.raises(ValueError, match='cannot preserve'): word_language('de-u-co-phonebk')
