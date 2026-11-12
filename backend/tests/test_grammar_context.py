"""Source-only context must not leak corrections or cross physical essays."""
import copy
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def fixture(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module = importlib.import_module('contextualize_pairs')
    digest = module.digest
    sources = ['First .', 'He go .', 'Last .', 'Other .', 'He go .']
    raw = {'sentences': [{'sourceIndex': i, 'source': source,
        'sourceSHA256': digest(source), 'documentGroup': 'essay-'+str(i//3)}
        for i, source in enumerate(sources)]}
    display = {'sentences': [{**row, 'source': row['source'].replace(' .', '.'),
        'sourceSHA256': digest(row['source'].replace(' .', '.'))} for row in raw['sentences']],
        'displayTransformation': {'parentDocumentMapSHA256': digest(raw)}}
    outputs = {'INPUT': sources, 'corrected': ['First .', 'He goes .', 'Last .', 'Other .', 'He went .']}
    def pair(index, split='calibration'):
        return {'id': digest([index, 'INPUT', 'corrected'])[:24], 'group': digest(display['sentences'][index]['source']),
            'split': split, 'source': display['sentences'][index]['source'],
            'a': outputs['INPUT'][index].replace(' .', '.'),
            'b': outputs['corrected'][index].replace(' .', '.'), 'systems': ['INPUT', 'corrected'],
            'humanWinner': 'B', 'humanVotes': {'B': 2}}
    return module, raw, display, outputs, pair


def test_context_keeps_original_sentences_and_preserves_every_label_and_fold(fixture):
    module, raw, display, outputs, pair = fixture
    original = [pair(1), pair(2)]
    result = module.contextualize(original, raw, display, outputs)
    assert result[0]['context'] == 'First.\nHe go.\nLast.'
    assert result[1]['context'] == 'He go.\nLast.'
    assert all({key: row[key] for key in parent} == parent for row, parent in zip(result, original))
    assert result[0]['contextProvenance']['sourceIndices'] == [0, 1, 2]
    assert result[0]['contextProvenance']['targetLine'] == 1


def test_explicit_source_only_context_can_be_augmented(fixture):
    module, raw, display, outputs, pair = fixture
    original = pair(1); original['context'] = original['source']
    result = module.contextualize([original], raw, display, outputs)[0]
    assert result['context'] == 'First.\nHe go.\nLast.'
    assert result['humanWinner'] == original['humanWinner']


def test_pair_id_resolves_duplicate_source_to_its_physical_essay(fixture):
    module, raw, display, outputs, pair = fixture
    result = module.contextualize([pair(4)], raw, display, outputs)[0]
    assert result['context'] == 'Other.\nHe go.'
    assert result['contextProvenance']['sourceIndex'] == 4
    assert 'Last.' not in result['context'] and 'went' not in result['context']


def test_duplicate_linked_essays_cannot_cross_folds_even_for_different_targets(fixture):
    module, raw, display, outputs, pair = fixture
    # The duplicate at 1/4 links both complete essays, including different targets.
    with pytest.raises(ValueError, match='cluster crosses'):
        module.contextualize([pair(0), pair(3, 'validation')], raw, display, outputs)


@pytest.mark.parametrize('mutation', ['id', 'candidate', 'source', 'map', 'context', 'split'])
def test_contextualization_rejects_unbound_or_overwritten_evidence(fixture, mutation):
    module, raw, display, outputs, pair = fixture
    rows = [pair(1), pair(2)]
    if mutation == 'id': rows[0]['id'] = 'unverified'
    if mutation == 'candidate': rows[0]['b'] = 'He went.'
    if mutation == 'source': rows[0]['source'] = 'He goes.'
    if mutation == 'map':
        display = copy.deepcopy(display)
        display['sentences'][0]['source'] = 'He goes.'
    if mutation == 'context': rows[0]['context'] = 'Corrected secret.'
    if mutation == 'split': rows[1]['split'] = 'validation'
    with pytest.raises(ValueError): module.contextualize(rows, raw, display, outputs)


def test_ambiguous_edit_source_quarantines_all_possible_sources(fixture, tmp_path, monkeypatch):
    module, _, _, _, _ = fixture
    importer = importlib.import_module('import_edit_acceptability')
    outputs = tmp_path/'outputs/all'; outputs.mkdir(parents=True)
    (outputs/'INPUT.txt').write_text('[He go .]\nHe go .\n', 'utf8')
    (outputs/'SYSTEM.txt').write_text('[He goes .]\nHe goes .\n', 'utf8')
    texts = [('annotator1', '<t>[He go .]</t>\n<Correction>\n<s1>He [go→goes|True] .</s1>'),
             ('annotator2', '<t>He go .</t>\n<Correction>\n<s1>He [go→goes|True] .</s1>'),
             ('annotator3', '<t>He go .</t>\n<Correction>\n<s1>He [go→goes|True] .</s1>')]
    for annotator, text in texts:
        directory = tmp_path/'data/EditEval_Step1'/annotator; directory.mkdir(parents=True)
        (directory/'1.txt').write_text(text, 'utf8')
    monkeypatch.setattr(importer.subprocess, 'check_output', lambda args, **kwargs:
        '' if 'status' in args else importer.REVISION)
    mapping = {'sentences': [{'source': text, 'documentGroup': 'essay-'+str(i)}
        for i, text in enumerate(('[He go .]', 'He go .'))]}
    cases, report = importer.inspect(tmp_path, mapping)
    assert cases == [] and report['quarantinedSources'] == 2


def test_orphan_edit_closing_tag_is_not_silently_ignored(fixture):
    importer = importlib.import_module('import_edit_acceptability')
    with pytest.raises(ValueError, match='IncompleteCorrectionTags'):
        importer.parse_file('<t>He go .</t>\n<Correction>\n<s1>He [go→goes|True] .</s1></s2>',
            {'Hego.': {'He go .'}})


def test_annotation_context_resolves_duplicate_sources_without_correction_labels(fixture):
    _,raw,_,_,_=fixture;importer=importlib.import_module('import_edit_acceptability')
    content='<Source with context>\nFirst .\n<t>[He go .]</t>\nLast .\n<Correction>\nDO NOT READ'
    assert importer.source_context_indices(content,'He go .',raw)==[1]
    assert importer.original_contexts([1],raw)==['First .\nHe go .\nLast .']


def test_context_identity_can_use_published_cross_essay_window_but_does_not_inject_it(fixture):
    _,raw,_,_,_=fixture;importer=importlib.import_module('import_edit_acceptability')
    content='<Source with context>\nHe go .\n<t>Last .</t>\nOther .\n<Correction>\nDO NOT READ'
    assert importer.source_context_indices(content,'Last .',raw)==[2]
    assert importer.original_contexts([2],raw)==['He go .\nLast .']


def test_context_identity_does_not_guess_an_unmatched_window(fixture):
    _,raw,_,_,_=fixture;importer=importlib.import_module('import_edit_acceptability')
    with pytest.raises(ValueError,match='UnalignedSourceContext'):
        importer.source_context_indices('<Source with context>\nUnrelated .<t>He go .</t>','He go .',raw)
    with pytest.raises(ValueError,match='TargetMismatch'):
        importer.source_context_indices('<Source with context>\nFirst .<t>He went .</t>Last .','He go .',raw)
