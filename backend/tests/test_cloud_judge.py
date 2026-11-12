"""Offline checks: public input permits, spending caps and final-only evidence."""
import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def cloud(monkeypatch,tmp_path):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('cloud_judge')
    profile={'model':'gpt-6.1-sol','reasoningEffort':'low','maxOutputTokens':2048}
    payload={'source':'They is late.','context':'They is late.','A':'They are late.','B':'They is late.',
             'dialect':'en-GB','profile':'standard','rubric':{}}
    canonical,_=module.canonical_payload(payload);identity=module.identity(profile)
    permit={'protocol':'alder-public-cloud-inputs-v1','publicDataOnly':True,
            'modelIdentitySHA256':module.digest(identity),'allowedCanonicalPayloads':[module.digest(canonical)]}
    budget=tmp_path/'budget.json'
    module.write(budget,{'protocol':'alder-openai-spend-v1','approved':True,'publicDataOnly':True,
        'allowedModelIdentities':[module.digest(identity)],'limitUSD':'1','events':[]})
    key=tmp_path/'existing-credential';key.write_text('sk-'+'x'*32,'utf8')
    calls=[]
    def transport(resource,body,secret):
        assert secret=='sk-'+'x'*32;calls.append((resource,body))
        if resource=='responses/input_tokens':return {'object':'response.input_tokens','input_tokens':100}
        assert body['store'] is False and body['service_tier']=='default' and body['tools']==[]
        assert body['truncation']=='disabled' and 'summary' not in body['reasoning']
        p=json.loads(body['input'][0]['content']);loser='A' if p['A']=='They is late.' else 'B'
        value={'winner':'B' if loser=='A' else 'A','defects':[{
            'candidate':loser,'quote':'is','reason':'Plural agreement.','dimension':'correctness'}]}
        return {'id':'fixture-response','model':profile['model'],'status':'completed',
                'usage':{'input_tokens':100,'output_tokens':50},'output':[
                    {'type':'reasoning','privateFixture':'must-never-be-saved'},
                    {'type':'message','role':'assistant','status':'completed','content':[
                        {'type':'output_text','text':json.dumps(value)}]}]}
    return module,profile,payload,permit,budget,tmp_path/'cache',key,calls,transport


def test_both_orders_share_one_public_call_without_private_output_or_secret_cache(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    assert module.evaluate(payload,profile,permit,budget,cache,key,transport)['winner']=='A'
    swapped={**payload,'A':payload['B'],'B':payload['A']}
    assert module.evaluate(swapped,profile,permit,budget,cache,key,transport)['winner']=='B'
    assert [name for name,_ in calls]==['responses/input_tokens','responses']
    saved=''.join(p.read_text('utf8') for p in cache.glob('*.json'))
    assert 'must-never-be-saved' not in saved and 'sk-' not in saved
    assert len(module.read(budget)['events'])==1


def test_unapproved_budget_prevents_even_token_counting(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    data=module.read(budget);data['approved']=False;module.write(budget,data)
    with pytest.raises(module.BudgetExceeded):module.evaluate(payload,profile,permit,budget,cache,key,transport)
    assert not calls


def test_revised_cloud_profile_requires_its_own_permit_and_budget_identity(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    revised={**profile,'maxInputTokens':2048,'editorialRubric':'grammar-aware-v1'}
    original_identity=module.identity(profile);revised_identity=module.identity(revised)
    assert original_identity['instructionSHA256']!=revised_identity['instructionSHA256']
    assert 'a changed surface form alone' in module.request_body(payload,revised)['instructions']
    with pytest.raises(ValueError,match='unchanged public-data permit and model profile'):
        module.evaluate(payload,revised,permit,budget,cache,key,transport)
    assert not calls


def test_revised_cloud_profile_without_fresh_approval_cannot_contact_api(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    revised={**profile,'maxInputTokens':2048,'editorialRubric':'grammar-aware-v1'}
    identity=module.identity(revised);permit={**permit,'modelIdentitySHA256':module.digest(identity)}
    data=module.read(budget);data.update(approved=False,allowedModelIdentities=[module.digest(identity)])
    module.write(budget,data)
    with pytest.raises(module.BudgetExceeded):module.evaluate(payload,revised,permit,budget,cache,key,transport)
    assert not calls


def test_unauthorized_document_cannot_reach_key_or_network(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    payload['source']='A private manuscript outside the public permit.'
    with pytest.raises(ValueError,match='authorized public benchmark'):
        module.evaluate(payload,profile,permit,budget,cache,key.with_name('absent'),transport)
    assert not calls


def test_insufficient_cap_stops_before_billable_inference(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    data=module.read(budget);data['limitUSD']='0.001';module.write(budget,data)
    with pytest.raises(module.BudgetExceeded):module.evaluate(payload,profile,permit,budget,cache,key,transport)
    assert [name for name,_ in calls]==['responses/input_tokens']
    assert module.read(budget)['events']==[]


def test_unknown_api_failure_retains_the_full_reservation_and_never_retries(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    def failing(resource,body,secret):
        if resource=='responses':raise module.Unavailable('Fixed safe failure.')
        return transport(resource,body,secret)
    with pytest.raises(module.Unavailable):module.evaluate(payload,profile,permit,budget,cache,key,failing)
    events=module.read(budget)['events']
    assert len(events)==1 and events[0]['settledUSD'] is None and events[0]['status']=='reserved'
    assert not list(cache.glob('*.json'))


def test_budget_luna_profile_can_cover_84_calls_within_fifteen_cents(cloud):
    module,*_=cloud
    profile={'model':'gpt-6-luna','reasoningEffort':'medium','maxOutputTokens':2048,'maxInputTokens':2048}
    identity=module.identity(profile)
    budget={'protocol':'alder-openai-spend-v1','approved':True,'publicDataOnly':True,
            'allowedModelIdentities':[module.digest(identity)],'limitUSD':'0.15','events':[]}
    for i in range(84):module.reserve(budget,identity,2048,str(i))
    assert sum(module.Decimal(row['reservedUSD']) for row in budget['events'])<module.Decimal('.15')


def test_grammar_aware_luna_needs_its_own_identity_and_approved_allowance(cloud):
    module,_,payload,permit,budget,cache,key,calls,transport=cloud
    original={'model':'gpt-6-luna','reasoningEffort':'medium','maxOutputTokens':2048,'maxInputTokens':2048}
    revised={**original,'editorialRubric':'grammar-aware-v1'}
    before=module.identity(original);after=module.identity(revised)
    assert before['instructionSHA256']!=after['instructionSHA256']
    assert module.digest(before)!=module.digest(after)
    permit={**permit,'modelIdentitySHA256':module.digest(after)}
    data=module.read(budget);data.update(allowedModelIdentities=[module.digest(before)],limitUSD='0.15')
    module.write(budget,data)
    with pytest.raises(module.BudgetExceeded):module.evaluate(payload,revised,permit,budget,cache,key,transport)
    assert [name for name,_ in calls]==['responses/input_tokens']
    assert not module.read(budget)['events']
    calls.clear();data.update(approved=False,allowedModelIdentities=[module.digest(after)]);module.write(budget,data)
    with pytest.raises(module.BudgetExceeded):module.evaluate(payload,revised,permit,budget,cache,key,transport)
    assert not calls


def test_revised_luna_ninety_request_worst_case_fits_the_proposed_cap(cloud):
    module,*_=cloud
    profile={'model':'gpt-6-luna','reasoningEffort':'medium','maxOutputTokens':2048,
        'maxInputTokens':2048,'editorialRubric':'grammar-aware-v1'}
    identity=module.identity(profile)
    budget={'protocol':'alder-openai-spend-v1','approved':True,'publicDataOnly':True,
        'allowedModelIdentities':[module.digest(identity)],'limitUSD':'0.15','events':[]}
    for i in range(90):module.reserve(budget,identity,2048,str(i))
    assert sum(module.Decimal(row['reservedUSD']) for row in budget['events'])<=module.Decimal('.15')


def test_bounded_public_failure_is_cached_instead_of_becoming_a_paid_order_retry(cloud):
    module,profile,payload,permit,budget,cache,key,calls,transport=cloud
    def incomplete(resource,body,secret):
        value=transport(resource,body,secret)
        if resource=='responses':value['status']='incomplete'
        return value
    assert module.evaluate(payload,profile,permit,budget,cache,key,incomplete)['winner']=='abstain'
    assert module.evaluate({**payload,'A':payload['B'],'B':payload['A']},profile,permit,budget,cache,key,incomplete)['winner']=='abstain'
    assert len(calls)==2 and len(module.read(budget)['events'])==1
    assert module.read(next(cache.glob('*.json')))['publicFailure']=='UnusablePublicJudgment'


@pytest.mark.parametrize('mutation',['truncated','model','quote','refusal'])
def test_unusable_provider_responses_never_become_public_judgments(cloud,mutation):
    module,profile,payload,_,_,_,_,_,transport=cloud
    response=transport('responses',module.request_body(payload,profile),'sk-'+'x'*32)
    if mutation=='truncated':response['status']='incomplete'
    if mutation=='model':response['model']='different-model'
    if mutation=='quote':
        part=response['output'][1]['content'][0];value=json.loads(part['text'])
        value['defects'][0]['quote']='invented quote';part['text']=json.dumps(value)
    if mutation=='refusal':response['output'][1]['content']=[{'type':'refusal','refusal':'Fixture refusal.'}]
    with pytest.raises(ValueError):module.public_judgment(response,payload,profile)
