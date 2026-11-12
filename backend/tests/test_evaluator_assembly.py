"""Final evaluator qualification requires complete, independent public evidence."""
import copy
import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def assembly(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    return importlib.import_module('qualify_evaluator')


def profile(family):
    return {'baseFamily':family,'readinessPassed':True,
        'calibration':{'publicEvidenceVerified':True,'complete':True,'agreement':.9,
            'abstentions':0,'orderInstability':0},
        'validation':{'pairwiseGatePassed':True,'publicEvidenceVerified':True,'complete':True,
            'agreement':.88,'interval':[.79,.94],'abstentions':0,'orderInstability':0},
        'semantics':{'status':'passed','publicEvidenceVerified':True,'inferenceStatus':'completed',
            'harmfulPreferences':0,'detectionRate':.98,'orderInstability':0},
        'ranking':{'status':'passed','selectionVerified':True,'spearman':.9,
            'humanPopulation':{'populationAlignmentVerified':True}}}


def test_two_complete_independent_profiles_can_qualify_only_the_evaluator(assembly):
    result=assembly.combine([profile('Qwen'),profile('Gemma')],'corpus','product-source')
    assert result['status']=='passed' and result['metrics']['qualifiedIndependentFamilies']==2
    assert result['metrics']['nonQwenFamilies']==1
    assert result['implementationSHA256']=='product-source'
    assert result['promotion'].startswith('none;')


@pytest.mark.parametrize('mutation',['same_family','harmful','no_evidence','incomplete','missing_semantics','no_ranking','failed_readiness','unmatched_human_sources'])
def test_incomplete_or_duplicate_families_cannot_close_the_gate(assembly,mutation):
    first=profile('Qwen');second=profile('Gemma')
    if mutation=='same_family':second['baseFamily']='Qwen'
    if mutation=='harmful':second['semantics']['harmfulPreferences']=1
    if mutation=='no_evidence':second['semantics']['publicEvidenceVerified']=False
    if mutation=='incomplete':second['validation']['complete']=False
    if mutation=='missing_semantics':second.pop('semantics')
    if mutation=='no_ranking':second['ranking']['status']='unverified'
    if mutation=='failed_readiness':second['readinessPassed']=False
    if mutation=='unmatched_human_sources':second['ranking']['humanPopulation']['populationAlignmentVerified']=False
    result=assembly.combine([first,second],'corpus','source')
    assert result['status']=='unverified' and result['metrics']['qualifiedIndependentFamilies']==1
    assert len(result['profiles'])==2  # Keep the adverse/incomplete evidence.


def test_profile_labels_cannot_manufacture_independent_families(assembly):
    review={'developerEvaluatorCandidates':[
        {'sha256':'dense','baseFamily':'Qwen3.5 Dense'},
        {'sha256':'moe','baseFamily':'Qwen3.5 MoE'}]}
    families=[assembly.reviewed_family({'modelSHA256':row['sha256'],'baseFamily':row['baseFamily']},review)
              for row in review['developerEvaluatorCandidates']]
    assert families==['Qwen','Qwen']
    with pytest.raises(ValueError,match='differs'):
        assembly.reviewed_family({'modelSHA256':'moe','baseFamily':'Independent invented family'},review)
    with pytest.raises(ValueError,match='reviewed'):
        assembly.reviewed_family({'modelSHA256':'unreviewed','baseFamily':'Qwen3.5 MoE'},review)


@pytest.mark.parametrize('mutation',['none','different_source','different_model','different_decoder','unbound_raw','reference_assisted'])
def test_all_stages_bind_the_exact_verified_inference_profile(assembly,tmp_path,mutation):
    config={'modelSHA256':'weights','revision':'revision','baseFamily':'Gemma','sourceArchiveSHA256':'source',
        'serverIdentity':{'modelSHA256':'weights','seed':917},'command':['fixture'],'preflightCommand':['fixture','identity']}
    expected=copy.deepcopy({key:config.get(key) for key in assembly.IDENTITY_FIELDS})
    if mutation=='different_source':config['sourceArchiveSHA256']='other'
    if mutation=='different_model':config['serverIdentity']['modelSHA256']='other'
    if mutation=='different_decoder':config['serverIdentity']['seed']=918
    if mutation=='reference_assisted':config['serverIdentity']['referenceAssistedOnly']=True
    raw={'judgeSHA256':assembly.digest(config),
        'judge':{k:v for k,v in config.items() if k not in ('command','preflightCommand')}}
    if mutation=='unbound_raw':raw['judgeSHA256']='other'
    stage={'config':str(tmp_path/'config.json'),'ratings':str(tmp_path/'ratings.json')}
    for name,data in (('config',config),('ratings',raw)):
        Path(stage[name]).write_text(json.dumps(data),'utf8')
    if mutation=='none':assert assembly.bound_ratings(stage,'source',expected)[0]==raw
    else:
        with pytest.raises(ValueError):assembly.bound_ratings(stage,'source',expected)


def test_readiness_checks_actual_evidence_and_the_full_declared_population(assembly):
    pair={'id':'control','source':'Alice go.','a':'Bob goes.','b':'Alice goes.','correctWinner':'B'}
    row={'id':'control','pairSHA256':assembly.digest(pair),'winner':'B','orderDecisions':['B','A'],
        'responses':[{'winner':winner,'defects':[{'candidate':loser,'quote':'Bob',
            'dimension':'meaning','reason':'Participant changed.'}]} for winner,loser in (('B','A'),('A','B'))]}
    raw={'status':'completed','requestedCases':1,'records':[row]}
    assert assembly.readiness([pair],raw)
    assert not assembly.readiness([pair],{**raw,'requestedCases':2})
    modified=copy.deepcopy(raw);modified['records'][0]['responses'][0]['defects'][0]['quote']='Invented'
    with pytest.raises(ValueError):assembly.readiness([pair],modified)
