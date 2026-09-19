from copy import deepcopy
import threading
import time

import pytest

from alder.models import ValidationError
from alder.proofreading.contracts import blocks, configuration, diagnostic, model_correction, shift, slice16, u16
from alder.proofreading.service import ProofreadingService


def finish(service, identifier, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = service.get(identifier)
        if job['status'] in ('completed', 'partial', 'cancelled', 'failed'):
            return job
        time.sleep(.01)
    raise AssertionError('Check did not finish')


@pytest.fixture
def service(tmp_path):
    instance = ProofreadingService(tmp_path / 'resources', tmp_path / 'data')
    yield instance
    instance.shutdown()


def test_unicode_offsets_and_linked_edits():
    text = '😀 He go and buy apples.'
    correction = model_correction(text, '😀 He goes and buys apples.', [])
    assert len(correction['alternatives'][0]['edits']) == 2
    result = text.encode('utf-16-le')
    for edit in reversed(correction['alternatives'][0]['edits']):
        assert slice16(text, edit['start'], edit['end']) == edit['originalText']
        result = result[:edit['start'] * 2] + edit['replacement'].encode('utf-16-le') + result[edit['end'] * 2:]
    assert result.decode('utf-16-le') == '😀 He goes and buys apples.'


@pytest.mark.parametrize('source,target', [
    ('I must attend.', 'I may attend.'), ('It costs 45 dollars.', 'It costs 54 dollars.'),
    ('We saw Alice yesterday.', 'We saw Alicia yesterday.'), ('Do not move.', 'Do move.'),
    ('Alice arrived.', 'Alicia arrived.'), ('Alice paid 27 pounds.', 'Alice paid £27.'),
    ('Correct text.', 'Correct\ntext.'), ('Hello.', ''),
])
def test_model_rejects_protected_or_structural_changes(source, target):
    assert model_correction(source, target, []) is None


def test_accepted_vocabulary_and_correct_text_are_protected():
    assert model_correction('We like Alderism.', 'We like activism.', ['Alderism']) is None
    assert model_correction('All is well.', 'All is well.', []) is None
    assert model_correction('“Not today,” she said.', '"Not today," she said.', []) is None


def test_zero_width_and_deletion_are_actions():
    item = diagnostic('the the cat', 4, 8, 'grammar', 'repeat', 'Repeated word', [''], 'rules')
    assert item['alternatives'][0]['edits'][0]['replacement'] == ''
    item = diagnostic('cats', 4, 4, 'punctuation', 'stop', 'Add punctuation', ['.'], 'rules')
    shifted = shift(deepcopy(item), 3)
    assert shifted['alternatives'][0]['edits'][0]['start'] == 7
    assert item['start'] == 4


def test_paragraph_offsets_do_not_normalize_text():
    result = list(blocks('😀 café\n\nTwo\tThree'))
    assert [item['start'] for item in result] == [0, 9, 13]
    assert result[0]['text'] == '😀 café'
    with pytest.raises(UnicodeError):
        slice16('😀', 0, 1)


def test_configuration_validation():
    assert configuration({'language': 'en-AU'})['dialect'] == 'en-AU'
    for invalid in ({'dialect': 'fr'}, {'acceptedWords': 'bad'}, {'acceptedWords': ['']}, {'style': 'true'}):
        with pytest.raises(ValidationError):
            configuration({}, invalid)


def test_missing_resources_never_report_a_clean_check(service):
    job = finish(service, service.start({'text': 'She go home.', 'targetId': 'chapter-a', 'advanced': True})['id'])
    assert job['status'] == 'partial'
    assert job['coverage']['skippedBlocks'] == 1
    assert len(job['warnings']) == 2


def test_missing_pack_retains_basic_spelling_and_personal_dictionary(service):
    result = finish(service, service.start({'text': 'This is mispelled.', 'targetId': 'a'})['id'])
    assert result['status'] == 'partial'
    spelling = [item for item in result['annotations'] if item['type'] == 'spelling']
    assert spelling[0]['originalText'] == 'mispelled'
    assert spelling[0]['alternatives'][0]['edits'][0]['replacement'] == 'misspelled'
    assert 'Full grammar and dialect checks were not performed' in result['warnings'][0]
    service.save_personal_words(['mispelled'])
    result = finish(service, service.start({'text': 'This is mispelled.', 'targetId': 'a'})['id'])
    assert not any(item['type'] == 'spelling' for item in result['annotations'])


def test_rules_checked_but_oversized_paragraphs_visible(service, monkeypatch):
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'rules': {'available': True}, 'model': {'available': False}})
    calls = []
    monkeypatch.setattr(service.rules, 'check', lambda text, config: calls.append(text) or [])
    job = finish(service, service.start({'text': 'Good.\n' + 'x' * 2500, 'targetId': 'chapter-a'})['id'])
    assert calls == ['Good.']
    assert job['status'] == 'partial'
    assert job['coverage'] == {'totalBlocks': 2, 'checkedBlocks': 1, 'advancedBlocks': 0, 'skippedBlocks': 1}


def test_superseded_request_is_cancelled(service, monkeypatch):
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'rules': {'available': True}, 'model': {'available': False}})
    entered = threading.Event()
    release = threading.Event()
    def check(text, config):
        if text == 'First.':
            entered.set()
            assert release.wait(2)
        return []
    monkeypatch.setattr(service.rules, 'check', check)
    first = service.start({'text': 'First.', 'targetId': 'same'})
    assert entered.wait(1)
    second = service.start({'text': 'Second.', 'targetId': 'same'})
    release.set()
    assert finish(service, first['id'])['status'] == 'cancelled'
    assert finish(service, second['id'])['status'] == 'completed'
    assert first['sourceHash'] != second['sourceHash']


def test_personal_words_persist_without_manuscript(service):
    assert service.save_personal_words(['Alderism', 'Alderism']) == ['Alderism']
    assert service.personal_words() == ['Alderism']
    assert list(service.data_dir.iterdir())[0].name == 'proofreading-dictionary.json'


def test_rule_failure_is_not_hidden(service, monkeypatch):
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'rules': {'available': True}, 'model': {'available': False}})
    def fail(*args):
        raise RuntimeError('Local checker unavailable')
    monkeypatch.setattr(service.rules, 'check', fail)
    job = finish(service, service.start({'text': 'Words.', 'targetId': 'a'})['id'])
    assert job['status'] == 'failed'
    assert 'Local checker unavailable' in job['warnings']


def test_project_rule_keeps_empty_replacement(service):
    project = {'settings': {'customRules': [{'id': 'remove', 'match': 'filler', 'replacement': '', 'message': 'Remove filler'}]}}
    job = finish(service, service.start({'text': 'filler', 'targetId': 'a'}, project)['id'])
    assert job['annotations'][0]['alternatives'][0]['edits'][0]['replacement'] == ''


def test_input_validation_before_any_worker(service):
    for data in ({'text': 'hello'}, {'text': 2, 'targetId': 'a'}, {'text': '\ud800', 'targetId': 'a'},
                 {'text': 'hello', 'targetId': 'a', 'advanced': 'yes'}):
        with pytest.raises(ValidationError):
            service.start(data)


def test_api_auth_and_cancellation(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path, session_token='test-token')
    with TestClient(app) as client:
        assert client.get('/api/proofreading/capabilities').status_code == 401
        headers = {'Authorization': 'Bearer test-token'}
        reply = client.post('/api/proofreading/check', headers=headers, json={'text': 'Hello.', 'targetId': 'a'})
        assert reply.status_code == 200
        assert client.delete('/api/proofreading/jobs/' + reply.json()['id'], headers=headers).status_code == 200
        assert client.put('/api/proofreading/dictionary', headers=headers, json={'words': ['Alderism']}).json() == {'words': ['Alderism']}


def test_long_paragraph_segmentation_keeps_every_character_and_offset():
    text = ('A complete sentence with an emoji 😀. ' * 150).rstrip()
    passages = list(blocks(text))
    assert len(passages) > 1
    assert ''.join(p['text'] for p in passages) == text
    assert all(p['eligible'] for p in passages)
    for passage in passages:
        assert slice16(text, passage['start'], passage['start'] + u16(passage['text'])) == passage['text']


def test_selected_passage_offsets_include_unicode_prefix(service, monkeypatch):
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'rules': {'available': True}, 'model': {'available': False}})
    def check(text, config):
        assert text == 'Bad'
        return [diagnostic(text, 0, 3, 'spelling', 'test', 'Fix', ['Good'], 'rules')]
    monkeypatch.setattr(service.rules, 'check', check)
    result = finish(service, service.start({'text': '😀 Bad end', 'targetId': 'a', 'range': {'start': 3, 'end': 6}})['id'])
    assert result['annotations'][0]['start'] == 3
    assert result['annotations'][0]['alternatives'][0]['edits'][0]['end'] == 6
    with pytest.raises(ValidationError):
        service.start({'text': '😀 Bad', 'targetId': 'a', 'range': {'start': 1, 'end': 3}})


def test_advanced_queue_never_blocks_fast_checks(service, monkeypatch):
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'rules': {'available': True}, 'model': {'available': True}})
    monkeypatch.setattr(service.rules, 'check', lambda text, config: [])
    entered = threading.Event()
    def inference(text, config, cancelled):
        entered.set()
        while not cancelled():
            time.sleep(.01)
        raise InterruptedError()
    monkeypatch.setattr(service.model, 'check', inference)
    first = service.start({'text': 'First.', 'targetId': 'a', 'advanced': True})
    assert entered.wait(1)
    second = service.start({'text': 'Second.', 'targetId': 'b', 'advanced': True})
    fast = service.start({'text': 'Fast.', 'targetId': 'c'})
    assert finish(service, fast['id'])['status'] == 'completed'
    service.cancel(first['id']); service.cancel(second['id'])
    assert finish(service, first['id'])['status'] == 'cancelled'


def test_model_memory_pressure_is_visible(monkeypatch):
    from alder.proofreading import memory
    monkeypatch.setattr(memory, 'available_memory', lambda: 2 * 2**30)
    with pytest.raises(RuntimeError, match='available memory'):
        memory.require_model_memory()


def test_model_checksum_failure_does_not_launch(tmp_path, monkeypatch):
    from alder.proofreading.engines import ModelEngine, Resources
    from alder.proofreading import engines
    resources = Resources(tmp_path)
    resources.model = tmp_path / 'wrong.gguf'; resources.model.write_bytes(b'corrupt')
    resources.model_hash = '0' * 64
    monkeypatch.setattr(resources, 'capabilities', lambda: {'model': {'available': True}})
    monkeypatch.setattr(engines, 'require_model_memory', lambda: None)
    def forbidden(*args, **kwargs):
        pytest.fail('Must not start an unverified model')
    monkeypatch.setattr(engines, 'launch', forbidden)
    with pytest.raises(RuntimeError, match='checksum'):
        ModelEngine(resources).check('Test.', configuration({}), lambda: False)


def test_malformed_pack_metadata_does_not_stop_alder(tmp_path):
    from alder.proofreading.engines import Resources
    directory = tmp_path / 'proofreading'; directory.mkdir()
    for data in ('[]', '{"model": null}', '{"model": {"file": 3, "sha256": null}}', '{broken'):
        (directory / 'manifest.json').write_text(data)
        assert Resources(tmp_path).capabilities()['model']['available'] is False
