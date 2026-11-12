"""Peer ranking must stay blinded, balanced and bound to held-out documents."""
import copy
import importlib
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize('mutation',['none','revision','tracked','untracked'])
def test_published_human_ranking_checkout_must_be_pinned_and_unchanged(data,tmp_path,monkeypatch,mutation):
    module,*_=data
    def git(*args):
        return subprocess.check_output(['git','-C',str(tmp_path),*args],text=True,stderr=subprocess.DEVNULL).strip()
    git('init','-b','main');(tmp_path/'judgments.txt').write_text('public fixture','utf8')
    git('add','judgments.txt')
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Public test fixture')
    revision=git('rev-parse','HEAD');monkeypatch.setattr(module,'SEEDA_REVISION',revision)
    if mutation=='revision':monkeypatch.setattr(module,'SEEDA_REVISION','0'*40)
    if mutation=='tracked':(tmp_path/'judgments.txt').write_text('changed labels','utf8')
    if mutation=='untracked':(tmp_path/'untracked.txt').write_text('unreviewed data','utf8')
    if mutation=='none':assert module.verify_source(tmp_path)==revision
    else:
        with pytest.raises(ValueError,match='pinned, unchanged'):module.verify_source(tmp_path)


@pytest.fixture
def data(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('peer_ranking')
    sources=[f'Original source {i}.' for i in range(3)]
    raw={'sentences':[{'sourceIndex':i,'source':text,'sourceSHA256':module.digest(text),
        'documentGroup':'essay-'+str(i)} for i,text in enumerate(sources)]}
    shown={**raw,'displayTransformation':{'parentDocumentMapSHA256':module.digest(raw)}}
    outputs={'INPUT':sources,**{f'system-{n}':[f'Correction {n} for source {i}.' for i in range(3)] for n in range(14)}}
    matrix=[{'sourceIndex':i,'system':name,'source':sources[i],'group':module.digest(sources[i]),
        'split':'validation','a':values[i],'b':sources[i]} for i in (1,2) for name,values in outputs.items()]
    cohort=[{'source':text,'split':'calibration' if i==0 else 'validation','humanWinner':'A'} for i,text in enumerate(sources)]
    return module,matrix,raw,shown,outputs,cohort


def test_hash_cycle_is_order_independent_and_has_two_peers_for_every_editor(data):
    module,matrix,raw,shown,outputs,cohort=data
    pairs=module.prepare(matrix,raw,shown,outputs,cohort)
    altered=copy.deepcopy(cohort)
    for row in altered:row['humanWinner']='B'
    assert pairs==module.prepare(list(reversed(matrix)),raw,shown,outputs,altered)
    sources,systems=module.shape(pairs)
    assert len(pairs)==30 and len(sources)==2 and len(systems)==15
    for comparisons in sources.values():
        counts={name:sum(name in pair['systems'] for pair in comparisons) for name in systems}
        assert set(counts.values())=={2}
    assert all(not {'humanWinner','humanVotes'}&pair.keys() for pair in pairs)
    assert all(pair['context']==pair['source'] for pair in pairs)  # Single-sentence essays.


@pytest.mark.parametrize('mutation',['output','duplicate','calibration','missing_system','label'])
def test_unbound_or_leaked_ranking_cells_fail(data,mutation):
    module,matrix,raw,shown,outputs,cohort=data
    if mutation=='output':matrix[0]['a']='Invented correction.'
    if mutation=='duplicate':matrix.append(copy.deepcopy(matrix[0]))
    if mutation=='calibration':cohort[1]['split']='calibration'
    if mutation=='missing_system':matrix.pop()
    if mutation=='label':matrix[0]['humanWinner']='A'
    with pytest.raises(ValueError):module.prepare(matrix,raw,shown,outputs,cohort)


def test_disconnected_cycles_are_not_accepted_as_balanced_ranking(data):
    module,matrix,raw,shown,outputs,cohort=data
    pairs=module.prepare(matrix,raw,shown,outputs,cohort)[:15]
    nodes=sorted(outputs);edges=[]
    for part in (nodes[:7],nodes[7:]):edges.extend((name,part[(i+1)%len(part)]) for i,name in enumerate(part))
    for pair,names in zip(pairs,edges):
        pair['systems']=list(names);pair['id']=module.digest([pair['sourceIndex'],*names])[:24]
    with pytest.raises(ValueError,match='disconnected'):module.shape(pairs)


def test_peer_ratings_require_valid_saved_quotes_and_both_orders(data):
    module,_,_,_,_,_=data
    pair={'source':'Source.','a':'bad first','b':'bad second'}
    row={'pairSHA256':module.digest(pair),'winner':'A','orderDecisions':['A','B'],
        'responses':[{'winner':winner,'defects':[{'candidate':loser,'quote':'bad','dimension':'fluency','reason':'Fixture.'}]}
            for winner,loser in (('A','B'),('B','A'))]}
    assert module.decision(row,pair)=='A'
    row['responses'][0]['defects'][0]['quote']='Invented quote'
    with pytest.raises(ValueError):module.decision(row,pair)


@pytest.mark.parametrize('mutation',['context','document','cycle'])
def test_evaluation_reconstructs_original_selection_context_and_cycle(data,mutation):
    module,matrix,raw,shown,outputs,cohort=data
    pairs=module.prepare(matrix,raw,shown,outputs,cohort)
    audit=module.verify_selection(pairs,matrix,raw,shown,outputs,cohort)
    assert audit['cohortSHA256']==module.digest(cohort) and audit['calibrationDocumentOverlap']==0
    if mutation=='context':pairs[0]['context']='Unrelated essay.'
    if mutation=='document':pairs[0]['documentGroup']='calibration-essay'
    if mutation=='cycle':pairs.reverse()  # Ordered frozen identity is also binding.
    with pytest.raises(ValueError,match='frozen source selection'):
        module.verify_selection(pairs,matrix,raw,shown,outputs,cohort)
