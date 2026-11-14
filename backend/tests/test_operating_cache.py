from alder.bounded_cache import ByteCache
from alder.proofreading.engines import RuleEngine
from alder.proofreading.contracts import configuration


def test_weighted_lru_bounds_and_releases_values():
    cache=ByteCache(1500,4)
    for i in range(10):cache[str(i)]='result'*20
    assert len(cache)<=4 and cache.retained_bytes<=1500
    key=next(iter(cache));cache.move_to_end(key)
    cache['new']='result'*20
    assert key in cache
    cache['oversized']='x'*2000
    assert 'oversized' not in cache
    cache.clear();assert cache.retained_bytes==0 and not cache


def test_rule_cache_reuses_unchanged_passages_and_keeps_configuration_identity():
    engine=RuleEngine(None);requests=[]
    engine._start=lambda:None
    engine._request=lambda *args: requests.append(args) or {'matches':[]}
    config=configuration({})
    for repeat in range(2):
        for i in range(1000):assert engine.check(f'Sentence {i}.',config)==[]
    assert len(requests)==1000
    assert engine.cache.retained_bytes<=engine.cache.maximum_bytes
    engine.check('Sentence 0.',{**config,'style':True});assert len(requests)==1001


def test_basic_passage_cache_matches_whole_context_and_invalidates_vocabulary(tmp_path, monkeypatch):
    import time
    from copy import deepcopy
    from alder import language
    from alder.proofreading.service import ProofreadingService
    from alder.proofreading.contracts import u16
    monkeypatch.delenv('ALDER_PROOFREADING_RESOURCES',raising=False)
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    text='😀 This  sentence has space !\n\n Another  line , yes.\r\nFinal  line.'
    original=language.analyze;calls=[]
    def analyze(source,*args,**kwargs):
        calls.append(source);return original(source,*args,**kwargs)
    monkeypatch.setattr(language,'analyze',analyze)
    def run():
        job=service.start({'text':text,'targetId':'cache-test','style':False})
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            result=service.get(job['id'])
            if result['status'] in ('partial','completed','failed'):return result
            time.sleep(.01)
        raise AssertionError('Checking did not finish')
    try:
        first=run(); count=len(calls);second=run()
        assert first['status']=='partial' and second['annotations']==first['annotations']
        assert len(calls)-count==1  # Whole-context project rules still run.
        expected=original(text,{},['spelling','punctuation'])['annotations']
        assert [(i['start'],i['end']) for i in first['annotations']]==[(i['start'],i['end']) for i in expected]
        assert all(0<=i['start']<=i['end']<=u16(text) for i in first['annotations'])
        job={'sequence':1,'annotations':[]};service._append(job,[]);service._update(job,annotations=[])
        assert job['sequence']==1
    finally:service.shutdown()
