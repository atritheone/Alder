from alder.proofreading.revisions import sentences, revision, passages
from alder.proofreading.contracts import configuration, language_segments, u16
from alder.proofreading.service import ProofreadingService
import time
import threading


def test_restructuring_is_not_limited_to_small_edits():
    source = 'The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.'
    target = 'The meeting was cancelled because nobody had confirmed whether they would attend.'
    item = revision(source, target, [])
    assert item['replacementText'] == target
    assert item['alternatives'][0]['edits'] == [{'start': 0, 'end': len(source), 'originalText': source, 'replacement': target}]


def test_capitalized_pronouns_are_not_names():
    assert revision('Their going home.', "They're going home.", [])
    assert revision('Nobody confirmed their attendance.', 'No one confirmed their attendance.', [])


def test_protected_values_keep_their_order():
    assert revision('He paid 10 and she paid 20.', 'He paid 20 and she paid 10.', []) is None
    assert revision('Alice must pay 10.', 'Alice may pay 10.', []) is None
    assert revision('Alice is here.', 'Alicia is here.', []) is None
    assert revision('Élodie has arrived.', 'Elodie has arrived.', []) is None
    assert revision('NASA published the report.', 'The agency published the report.', []) is None
    assert revision('Alice recommended Bob.', 'Bob recommended Alice.', []) is None
    assert revision('Alice paid 10 and Bob paid 20.', 'Bob paid 10 and Alice paid 20.', []) is None


def test_sentence_offsets_preserve_emoji_and_abbreviations():
    text = '😀 Dr. Smith arrived. Their going home. Last fragment'
    parts = list(sentences(text))
    assert [p['text'] for p in parts] == ['😀 Dr. Smith arrived.', 'Their going home.', 'Last fragment']
    for part in parts:
        assert text.encode('utf-16-le')[part['start']*2:part['end']*2].decode('utf-16-le') == part['text']


def test_selected_revision_has_full_context_and_exact_source_offsets(tmp_path, monkeypatch):
    monkeypatch.delenv('ALDER_PROOFREADING_RESOURCES', raising=False)
    service = ProofreadingService(tmp_path/'resources', tmp_path/'data')
    calls=[]
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'model':{'available':True}})
    def check(text, config, cancelled):
        calls.append((text,config))
        return "They're going home."
    monkeypatch.setattr(service.model, 'check', check)
    source='😀 Earlier context. Their going home. Later context.'
    start=len('😀 Earlier context. '.encode('utf-16-le'))//2
    try:
        job=service.start({'text':source,'targetId':'chapter','revision':True,'range':{'start':start,'end':start+len('Their going home.')}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert calls[0][1]['context']==source
        assert job['annotations'][0]['start']==start
        assert job['annotations'][0]['originalText']=='Their going home.'
    finally:service.shutdown()


def test_inline_citation_stays_in_its_sentence_and_is_protected():
    source='The report (Dr. Smith, 2020) it explains the process.'
    start=u16('The report ')
    end=start+u16('(Dr. Smith, 2020)')
    config=configuration({})
    segments=language_segments(source,[{'start':start,'end':end,'language':'zxx'}],config['dialect'])
    parts=list(passages(source,source,0,segments,config,None))
    assert len(parts)==1
    assert parts[0]['text']==source
    assert '(Dr. Smith, 2020)' in parts[0]['configuration']['acceptedWords']
    assert revision(source,'The report (Dr. Jones, 2020) explains the process.',parts[0]['configuration']['acceptedWords']) is None
    assert revision(source,'The report (Dr. Smith, 2020) explains the process.',parts[0]['configuration']['acceptedWords'])


def test_background_review_yields_between_sentences(tmp_path, monkeypatch):
    monkeypatch.delenv('ALDER_PROOFREADING_RESOURCES',raising=False)
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    entered=threading.Event();release=threading.Event();calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True}})
    def check(text,config,cancelled):
        calls.append(text)
        if len(calls)==1:entered.set();release.wait(2)
        return text
    monkeypatch.setattr(service.model,'check',check)
    try:
        book=service.start({'text':'Book one. Book two. Book three.','targetId':'book','revision':True})
        assert entered.wait(1)
        current=service.start({'text':'Recent sentence.','targetId':'current','revision':True})
        release.set()
        deadline=time.monotonic()+3
        while time.monotonic()<deadline and service.get(book['id'])['status']=='running':time.sleep(.01)
        assert calls[:2]==['Book one.','Recent sentence.']
        assert service.get(current['id'])['status']=='completed'
        assert service.get(book['id'])['status']=='completed'
    finally:release.set();service.shutdown()
