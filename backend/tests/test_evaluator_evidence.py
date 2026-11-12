"""Semantic and composite qualification must bind actual saved judgments."""
import copy
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def semantic(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    scorer=importlib.import_module('evaluate_semantics')
    pairs=[];rows=[]
    for i in range(200):
        pair={'id':str(i),'group':'family-'+str(i%8),'category':'category-'+str(i%8),
            'source':'Alice go.','a':'Alice goes.','b':'Bob goes.','correctWinner':'A',
            'construction':'both-rewritten'}
        pairs.append(pair)
        rows.append({'id':str(i),'pairSHA256':scorer.digest(pair),'winner':'A','orderDecisions':['A','B'],
            'responses':[{'winner':winner,'defects':[{'candidate':loser,'quote':'Bob',
              'dimension':'meaning','reason':'Participant changed.'}]} for winner,loser in (('A','B'),('B','A'))]})
    return scorer,pairs,{'status':'completed','judge':{'family':'fixture','modelSHA256':'fixture'},'records':rows}


def test_semantics_reconstructs_both_saved_orders(semantic):
    scorer,pairs,ratings=semantic
    result=scorer.evaluate(pairs,ratings)
    assert result['status']=='passed' and result['detectionRate']==1
    assert result['publicEvidenceVerified'] and result['orderCoverage']==1
    assert result['ratingsSHA256']==scorer.digest(ratings) and result['harmfulPreferences']==0


def test_one_known_harmful_preference_fails_despite_99_percent_detection(semantic):
    scorer,pairs,ratings=semantic
    row=ratings['records'][0];row['winner']='B';row['orderDecisions']=['B','A']
    row['responses']=[{'winner':winner,'defects':[{'candidate':loser,'quote':'Alice',
        'dimension':'meaning','reason':'Deliberately wrong fixture.'}]} for winner,loser in (('B','A'),('A','B'))]
    result=scorer.evaluate(pairs,ratings)
    assert result['detectionRate']==.995 and result['harmfulPreferences']==1 and result['status']=='failed'


def test_semantic_abstentions_and_missing_rows_remain_in_denominator(semantic):
    scorer,pairs,ratings=semantic
    ratings['records']=ratings['records'][5:]
    row=ratings['records'][0];row.update(winner='abstain',orderDecisions=['abstain','abstain'],responses=[None,None])
    result=scorer.evaluate(pairs,ratings)
    assert result['correct']==194 and result['detectionRate']==.97 and result['missing']==5
    assert result['publicEvidenceVerified'] and result['orderCoverage']==.975


@pytest.mark.parametrize('mutation', ['order','quote','hash','duplicate','winner'])
def test_semantics_rejects_tampered_judgment_evidence(semantic,mutation):
    scorer,pairs,ratings=semantic
    row=ratings['records'][0]
    if mutation=='order':row['orderDecisions']=['B','A']
    if mutation=='quote':row['responses'][0]['defects'][0]['quote']='Invented person'
    if mutation=='hash':row['pairSHA256']='other'
    if mutation=='duplicate':ratings['records'].append(copy.deepcopy(row))
    if mutation=='winner':row['winner']='tie'
    with pytest.raises(ValueError):scorer.evaluate(pairs,ratings)


def test_legacy_numeric_decisions_are_diagnostic_without_public_defect_evidence(semantic):
    scorer,pairs,ratings=semantic
    for row in ratings['records']:row.pop('responses')
    result=scorer.evaluate(pairs,ratings)
    assert result['detectionRate']==1 and result['publicEvidenceVerified'] is False
    assert result['status']=='unverified'


@pytest.mark.parametrize('mutation',['harmful','unverified','missing_harmful','missing_evidence','none'])
def test_composite_gate_enforces_zero_harmful_preferences_and_public_evidence(semantic,mutation):
    qualification=importlib.import_module('qualify')
    metrics={'qualifiedIndependentFamilies':2,'nonQwenFamilies':1,'pairAgreementLower95':.81,
        'pairAgreement':.9,'rankingSpearman':.9,'harmfulDetection':.995,
        'harmfulPreferences':0,'publicEvidenceVerified':True,'orderInstability':0,'abstentions':.01}
    if mutation=='harmful':metrics['harmfulPreferences']=1
    if mutation=='unverified':metrics['publicEvidenceVerified']=False
    if mutation=='missing_harmful':metrics.pop('harmfulPreferences')
    if mutation=='missing_evidence':metrics.pop('publicEvidenceVerified')
    artifact={'status':'passed','protocol':'alder-grammar-gate-v2','gate':'evaluator',
        'corpusSHA256':'fixture','implementationSHA256':'fixture','metrics':metrics}
    result=qualification.artifact_status('evaluator',artifact)
    assert result==('passed' if mutation=='none' else 'unverified' if mutation.startswith('missing') else 'failed')


def calibration_population(semantic,monkeypatch):
    scorer,pairs,ratings=semantic
    calibration=importlib.import_module('calibrate')
    for i,(pair,row) in enumerate(zip(pairs,ratings['records'])):
        pair.update(source='Alice go '+str(i)+'.',split='validation',humanWinner='A')
        row['pairSHA256']=scorer.digest(pair)
    partition=[{'source':'A separate calibration essay.','split':'calibration'}]
    clusters={scorer.digest(p['source']):'document-'+str(i%25) for i,p in enumerate(pairs)}
    clusters[scorer.digest(partition[0]['source'])]='calibration-document'
    monkeypatch.setattr(importlib.import_module('conll_documents'),'source_clusters',lambda mapping:clusters)
    return calibration,pairs,ratings,partition


def test_calibration_qualification_requires_actual_public_judgments(semantic,monkeypatch):
    calibration,pairs,ratings,partition=calibration_population(semantic,monkeypatch)
    report=calibration.calibrate(pairs,ratings,document_map={'fixture':True},partition_pairs=partition)
    assert report['pairwiseGatePassed'] and report['publicEvidenceVerified']
    assert report['publicEvidenceCoverage']==1
    for row in ratings['records']:row.pop('responses')
    diagnostic=calibration.calibrate(pairs,ratings,document_map={'fixture':True},partition_pairs=partition)
    assert diagnostic['agreement']==1 and not diagnostic['pairwiseGatePassed']
    assert not diagnostic['publicEvidenceVerified'] and diagnostic['publicEvidenceCoverage']==0


def test_verified_calibration_keeps_frozen_missing_coverage_allowance(semantic,monkeypatch):
    calibration,pairs,ratings,partition=calibration_population(semantic,monkeypatch)
    ratings['records']=ratings['records'][14:]
    report=calibration.calibrate(pairs,ratings,document_map={'fixture':True},partition_pairs=partition)
    assert report['pairwiseGatePassed'] and report['missing']==14
    assert report['agreement']==.93 and report['publicEvidenceCoverage']==.93
    assert report['publicEvidenceVerified'] and report['abstentions']==.07


@pytest.mark.parametrize('mutation',['quote','order','incomplete'])
def test_calibration_rejects_spliced_or_invented_evidence(semantic,monkeypatch,mutation):
    calibration,pairs,ratings,partition=calibration_population(semantic,monkeypatch)
    row=ratings['records'][0]
    if mutation=='quote':row['responses'][0]['defects'][0]['quote']='Invented person'
    if mutation=='order':row['responses'].reverse()
    if mutation=='incomplete':row['responses'].pop()
    with pytest.raises(ValueError):
        calibration.calibrate(pairs,ratings,document_map={'fixture':True},partition_pairs=partition)
