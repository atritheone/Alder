"""The repaired cohort uses all eligible human sources, never judge outcomes."""
import copy
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def data(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('ranking_population')
    sources=[f'Original source {i}.' for i in range(4)]
    raw={'sentences':[{'sourceIndex':i,'source':text,'sourceSHA256':module.digest(text),
        'documentGroup':f'essay-{i}'} for i,text in enumerate(sources)]}
    shown={**raw,'displayTransformation':{'parentDocumentMapSHA256':module.digest(raw)}}
    outputs={'INPUT':sources,**{f'system-{n}':[f'Correction {n} for {i}.' for i in range(4)] for n in range(14)}}
    matrix=[{'id':'rank-'+module.digest([i,name])[:24],'sourceIndex':i,'system':name,'source':sources[i],
        'group':module.digest(sources[i]),'split':'validation','a':values[i],'b':sources[i]}
        for i in (1,3) for name,values in sorted(outputs.items())]
    cohort=[{'source':text,'split':'calibration' if i==0 else 'validation','humanWinner':'A'}
        for i,text in enumerate(sources)]
    return module,matrix,raw,shown,outputs,cohort


def test_repair_retains_eligible_pairs_exactly_and_excludes_only_unrated_old_sources(data):
    module,matrix,raw,shown,outputs,cohort=data
    old=module.prepare(matrix,raw,shown,outputs,cohort);snapshot=copy.deepcopy(matrix)
    updated,pairs,audit=module.build(matrix,raw,shown,outputs,cohort,{0,1,2},lambda value:value)
    assert matrix==snapshot and len(updated)==30 and len(pairs)==30
    assert audit['eligibleSourceIndices']==[1,2]
    assert audit['retainedOriginalSourceIndices']==[1] and audit['excludedUnratedOriginalSourceIndices']==[3]
    assert audit['addedHumanRatedSourceIndices']==[2] and audit['calibrationDocumentOverlap']==0
    by_id={p['id']:p for p in pairs}
    assert all(by_id[p['id']]==p for p in old if p['sourceIndex']==1)


def test_selection_ignores_preference_labels_and_output_availability(data):
    module,matrix,raw,shown,outputs,cohort=data
    _,_,before=module.build(matrix,raw,shown,outputs,cohort,{0,1,2},lambda value:value)
    for row in cohort:row['humanWinner']='B'
    outputs['system-0'][2]=''
    _,pairs,after=module.build(matrix,raw,shown,outputs,cohort,{0,1,2},lambda value:value)
    assert before['eligibleSourceIndices']==after['eligibleSourceIndices']==[1,2]
    assert len(pairs)==30 and any(not pair['a'] or not pair['b'] for pair in pairs)


@pytest.mark.parametrize('mutation',['old_output','index','fold'])
def test_corrupted_or_leaked_populations_fail(data,mutation):
    module,matrix,raw,shown,outputs,cohort=data;human={0,1,2}
    if mutation=='old_output':matrix[0]['a']='Unpublished correction.'
    if mutation=='index':human.add(99)
    if mutation=='fold':cohort.append({'source':cohort[0]['source'],'split':'validation'})
    with pytest.raises(ValueError):module.build(matrix,raw,shown,outputs,cohort,human,lambda value:value)
