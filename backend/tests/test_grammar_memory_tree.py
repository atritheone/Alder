"""A model launched through a small redirector must include its actual child."""
import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def memory(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('memory')
    monkeypatch.setattr(module.os,'getpid',lambda:1)
    # The backend owns both launchers, each with its own descendant. Process 99
    # belongs to another application and must never enter these measurements.
    monkeypatch.setattr(module,'process_parents',lambda:{1:0,2:1,3:1,4:2,5:4,6:3,99:0})
    monkeypatch.setattr(module,'peak_rss',lambda pid:{1:10,2:2,3:3,4:40,5:5,6:6,99:999}[pid])
    service=SimpleNamespace(model=SimpleNamespace(process=SimpleNamespace(pid=2)),
                            rules=SimpleNamespace(process=SimpleNamespace(pid=3)))
    return module,module.Monitor(service)


def test_redirector_model_children_are_counted_without_backend_double_count(memory):
    _,monitor=memory
    report=monitor.result()
    assert report['componentPeakRSSBytes']=={'backend':10,'model':47,'rules':9}
    assert report['sumComponentPeakRSSBytes']==66 and report['processTreeCoverage']


def test_missing_child_peak_cannot_produce_a_false_resource_pass(memory,monkeypatch):
    module,monitor=memory;original=module.peak_rss
    monkeypatch.setattr(module,'peak_rss',lambda pid:None if pid==4 else original(pid))
    report=monitor.result()
    assert report['sumComponentPeakRSSBytes'] is None and not report['processTreeCoverage']
    assert report['incompleteComponents']==['model']


def test_snapshot_failure_remains_unverified_after_later_success(memory,monkeypatch):
    module,monitor=memory;original=module.process_parents
    monkeypatch.setattr(module,'process_parents',lambda:None);monitor.sample()
    monkeypatch.setattr(module,'process_parents',original)
    report=monitor.result()
    assert report['componentPeakRSSBytes']['model']==47
    assert report['sumComponentPeakRSSBytes'] is None and report['incompleteComponents']==['model','rules']


def test_lineage_cycles_do_not_loop_or_include_other_trees(memory):
    module,_=memory
    assert module.descendants(2,{2:4,4:2,5:4,99:0})=={2,4,5}


@pytest.mark.parametrize('collector',['legacy','incomplete'])
def test_auditor_cannot_turn_unverified_peaks_into_a_resource_pass(memory,collector):
    module,_=memory;auditor=importlib.import_module('audit_inference')
    case={'id':'a','source':'He go.','split':'development','group':'g',
          'track':'correctness','dialect':'en-AU','profile':'standard'}
    data={'cases':[case]}
    sample={'componentPeakRSSBytes':{'backend':10,'model':200,'rules':30}}
    if collector=='incomplete':sample.update(processTreeCoverage=False,incompleteComponents=['model'])
    manifest={'fingerprint':'run','status':'completed','settings':{
        'corpus':auditor.digest(data),'split':'development','implementation':{},'model':'fixture'}}
    row={'id':'a','source':case['source'],'fingerprint':'run','status':'completed',
         'seconds':1,'memory':sample,'modelTrace':[{'proposal':'He goes.'}]}
    report=auditor.summarize(data,[row],manifest)['memory']
    assert report['observedComponentPeakSumBytes']==240
    assert report['sumComponentPeakRSSBytes'] is None
    assert report['processTreeCoverage'] is (False if collector=='incomplete' else None)
