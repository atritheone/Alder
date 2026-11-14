from concurrent.futures import ThreadPoolExecutor
import threading
import pytest
from alder.work_policy import WorkPolicy
from alder import language


def test_save_priority_releases_background_waiters_and_cancellation():
    policy=WorkPolicy();waiting=threading.Event();cancel=threading.Event()
    def background(): waiting.set();return policy.checkpoint(cancel.is_set)
    with ThreadPoolExecutor(1) as pool:
        with policy.interactive():
            task=pool.submit(background);assert waiting.wait(1)
            assert not task.done()
            cancel.set()
            assert task.result(timeout=1) is False
        assert policy.report()['interactive']==policy.report()['waitingBackground']==0
        with policy.interactive():
            cancel.clear();task=pool.submit(background)
        assert task.result(timeout=1) is True


def test_exception_does_not_starve_background_work():
    policy=WorkPolicy()
    with pytest.raises(RuntimeError):
        with policy.interactive(): raise RuntimeError('failed save')
    assert policy.checkpoint() is True


def test_checkpoints_keep_analysis_results_and_unicode_offsets():
    text='😀 A sentence (with brackets). Another [sentence].\nUnclosed { bracket.'
    calls=[]
    expected=language.analyze(text,{},['brackets','punctuation','repetition','sentence-length','sentence-openings'])
    actual=language.analyze(text,{},['brackets','punctuation','repetition','sentence-length','sentence-openings'],checkpoint=lambda:calls.append(1))
    assert expected==actual and calls
