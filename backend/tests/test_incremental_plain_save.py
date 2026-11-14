from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import random
import threading
import pytest
from alder.models import validate_project, text_document
from alder.project_changes import apply_project_changes, plain_text_edit
from alder.store import Store, ConflictError
from alder.models import ValidationError


def fixture(store, text='First 🦉.\nSecond line.'):
    project=store.create(template='blank')
    project['settings'].update(documentKind='txt',includeTitle=False)
    project['book']={'version':1,'chapters':[{'id':'chapter','title':'Text','document':text_document(text),'include':True}]}
    return store.update(project['id'],project,project['revision'])


def test_incremental_plain_edits_match_whole_project_validation(tmp_path):
    store=Store(tmp_path)
    base=fixture(store)
    randomizer=random.Random(45)
    for _ in range(100):
        original=deepcopy(base)
        text=''.join(randomizer.choice('abc 字😀é\t') for _ in range(randomizer.randrange(1,90)))
        changes=[{'path':['book','chapters',0,'document','content',0,'content',0,'text'],'value':text},
                 {'path':['book','chapters',0,'text'],'value':'incorrect derived text'}]
        submitted=apply_project_changes(base,changes,persistent=True)
        source=deepcopy(submitted)
        fast=plain_text_edit(base,submitted,changes)
        assert fast is not None
        assert fast==validate_project(submitted,base)
        saved=store.update(base['id'],submitted,base['revision'],_base=base,_changes=changes)
        expected=validate_project(submitted,base)
        for key in ('revision','updatedAt'): expected[key]=saved[key]
        assert saved==expected==store.get(base['id'])
        assert base==original and submitted==source
        base=saved


@pytest.mark.parametrize('changes',[
    [{'path':['settings','fontSize'],'value':13}],
    [{'path':['book','chapters',0,'document','content',0,'attrs','align'],'value':'center'}],
    [{'path':['book','chapters',0,'document','content',0,'content',0,'marks'],'value':[{'type':'bold'}]}],
    [{'path':['book','chapters',0,'document','content',0,'attrs','blockId'],'value':'new_identity'}],
    [{'path':['book','chapters',0,'document','content'],'value':[{'type':'paragraph'}]}],
])
def test_non_text_edits_use_the_complete_validator(tmp_path,changes):
    base=fixture(Store(tmp_path))
    submitted=apply_project_changes(base,changes,persistent=True)
    assert plain_text_edit(base,submitted,changes) is None


def test_empty_plain_runs_and_wrong_plain_claims(tmp_path):
    store=Store(tmp_path);base=fixture(store,'')
    changes=[{'path':['book','chapters',0,'document','content',0,'content'],'value':[{'type':'text','text':'new'}]}]
    submitted=apply_project_changes(base,changes,persistent=True)
    assert plain_text_edit(base,submitted,changes)==validate_project(submitted,base)
    altered={**submitted,'settings':{**submitted['settings'],'fontSize':-1}}
    assert plain_text_edit(base,altered,changes) is None


@pytest.mark.parametrize('path',[['updatedAt'],['book','chapters',0,'text']])
def test_discarded_scalar_cannot_bypass_structured_size_limit(tmp_path,monkeypatch,path):
    store=Store(tmp_path);base=fixture(store)
    import alder.models as models
    monkeypatch.setattr(models,'MAX_PROJECT_BYTES',len(json.dumps(base,ensure_ascii=False).encode('utf-8'))+100)
    changes=[{'path':path,'value':'X'*10000}]
    submitted=apply_project_changes(base,changes,persistent=True)
    with pytest.raises(ValidationError,match='structured-text limit'):
        store.update(base['id'],submitted,base['revision'],_base=base,_changes=changes)
    assert store.get(base['id'])==base


def test_validation_does_not_hold_the_writer_lock_and_rechecks_revision(tmp_path,monkeypatch):
    store=Store(tmp_path);base=fixture(store)
    entered=threading.Event();release=threading.Event()
    import alder.store as module
    real=module.validate_project
    def slow(*args,**kwargs):
        entered.set();assert release.wait(5);return real(*args,**kwargs)
    monkeypatch.setattr(module,'validate_project',slow)
    loser={**base,'name':'stale update'}
    with ThreadPoolExecutor(2) as pool:
        pending=pool.submit(store.update,base['id'],loser,base['revision'])
        assert entered.wait(2)
        def observe():
            with store._lock: return True
        assert pool.submit(observe).result(timeout=1)
        monkeypatch.setattr(module,'validate_project',real)
        winner=store.update(base['id'],{**base,'name':'winner'},base['revision'])
        release.set()
        with pytest.raises(ConflictError): pending.result(timeout=2)
    assert store.get(base['id'])==winner
