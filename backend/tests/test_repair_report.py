"""Incomplete trials and missing repairs cannot become positive study evidence."""
from pathlib import Path
import pytest


@pytest.fixture
def report(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    from repair_report import summarize
    return summarize


def inputs():
    case={'id':'a','source':'He go at 9.','track':'semantic','reference':'He goes at 9.',
          'required':['9'],'forbidden':['10'],'protected':['9']}
    row={'id':'a','source':case['source'],'proposal':'He goes at 9.','status':'completed',
         'seconds':2,'modelTrace':[],'coldStart':{'model':False}}
    return case,row


def test_withheld_proposal_remains_a_missed_correction(report):
    case,row=inputs();row['status']='failed'
    result=report([case],[row])
    assert result['tracks']['semantic']['exactReference']==0
    assert result['changed']==0 and result['serviceFailuresOrWithholds']==1


@pytest.mark.parametrize('mode',['missing','duplicate','unknown','extra-call','bad-latency'])
def test_invalid_trial_cannot_be_reported_complete(report,mode):
    case,row=inputs();rows=[row]
    if mode=='missing':rows=[]
    if mode=='duplicate':rows=[row,row]
    if mode=='unknown':row['id']='different'
    if mode=='extra-call':row['modelTrace']=[{}, {}, {}]
    if mode=='bad-latency':row['seconds']=float('nan')
    with pytest.raises(ValueError):report([case],rows)


def test_bad_fact_in_completed_output_fails_explicit_controls(report):
    case,row=inputs();row['proposal']='He goes at 10.'
    result=report([case],[row])
    assert result['tracks']['semantic']['failedRequirements']==1
