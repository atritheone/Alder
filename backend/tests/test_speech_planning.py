"""Staged sections must retain the eager planner's exact source and voice identity."""
import copy
import json

import pytest

from alder.speech import SpeechService
from alder.speech_planning import narration_plan, append_sections
from alder.speech_quality import projected_sections


def voice(voice_id):
    return {'id': voice_id, 'hash': voice_id, 'provider': 'sapi' if voice_id.startswith('sapi-') else 'chatterbox-turbo'}


@pytest.mark.parametrize('interactive', [False, True])
def test_batches_match_eager_projection_across_sources_and_json_resume(monkeypatch, interactive):
    monkeypatch.setattr('alder.speech_planning.PLAN_BATCH', 3)
    phrase = 'distant northern mountain range'
    prose = ('Zoë follows the words 😀 through ' + 'a quiet valley ' * 9 + phrase + '. Another sentence.\n\n') * 12
    sources = [{'text': prose, 'voiceId': 'default', 'clipId': 'a', 'sectionId': 'one'},
               {'text': prose, 'voiceId': 'sapi-local', 'clipId': 'b', 'sectionId': 'two'}]
    rules = [{'word': phrase, 'spoken': 'high mountains'}]
    service = object.__new__(SpeechService)
    job = {'text': '\n\n'.join(s['text'] for s in sources), 'chunks': [], 'seed': 42,
           'settings': {'pauseSeconds': .18}, 'modelRevision': 'model', 'sourceFingerprint': 'source',
           '_narrationPlan': narration_plan(sources, rules, voice, interactive), 'hasMoreText': True}
    expected, occurrences, offset = [], {}, 0
    for source in sources:
        for chunk in projected_sections(source['text'], rules, source['voiceId'], lead_chars=80 if interactive and not expected else None):
            expected.append(service._narration_chunk(job, chunk, {**source, 'voice': voice(source['voiceId'])}, offset, occurrences))
        offset += len(source['text']) + 2
    batches = 0
    while job['hasMoreText']:
        before = len(job['chunks'])
        append_sections(job, lambda *args: service._narration_chunk(job, *args))
        assert 0 < len(job['chunks']) - before <= 3
        # A process restart must preserve seeds, duplicate occurrence IDs and offsets.
        job = json.loads(json.dumps(job, ensure_ascii=False))
        batches += 1
    assert batches > 10
    assert job['chunks'] == expected
    assert '_narrationPlan' not in job
    assert len({c['id'] for c in job['chunks']}) == len(job['chunks'])
    assert all(job['text'][c['sourceStart']:c['sourceEnd']] == c['text'] for c in job['chunks'])


def test_later_invalid_replacement_does_not_partially_commit_a_batch(monkeypatch):
    monkeypatch.setattr('alder.speech_planning.PLAN_BATCH', 2)
    text = 'First sentence. Second sentence. Third sentence. Oversized.'
    rules = [{'word': 'Oversized', 'spoken': 'unbounded ' * 70}]
    job = {'text': text, 'chunks': [], 'hasMoreText': True,
           '_narrationPlan': narration_plan([{'text': text, 'voiceId': 'default'}], rules, voice, False)}
    append_sections(job, lambda chunk, *_: chunk)
    before = copy.deepcopy(job)
    with pytest.raises(ValueError, match='replacement is too long'):
        append_sections(job, lambda chunk, *_: chunk)
    assert job == before


def test_no_speakable_source_does_not_leave_an_empty_live_plan():
    with pytest.raises(ValueError, match='Enter some text'):
        narration_plan([{'text': '.\n\n' * 100, 'voiceId': 'default'}], [], voice, False)
