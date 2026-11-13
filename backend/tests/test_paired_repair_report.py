"""Incomplete or mismatched evaluations cannot become positive repair evidence."""
import copy
import importlib
from pathlib import Path
import pytest


@pytest.fixture
def study(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('paired_repair_report')
    data={'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[
        {'id':'error','group':'error','split':'development','track':'correctness',
         'profile':'standard','dialect':'en-GB','source':'The files was late.',
         'reference':'The files were late.','protected':['files']},
        {'id':'clean','group':'clean','split':'development','track':'clean',
         'profile':'standard','dialect':'en-GB','source':'The files arrived.',
         'reference':'The files arrived.'}]}
    def rows(corrected):
        return [{'id':case['id'],'source':case['source'],
                 'proposal':case['reference'] if corrected else case['source'],
                 'displayed':corrected and case['id']=='error','status':'completed',
                 'fingerprint':'fixture','seconds':1,'modelTrace':[{'proposal':case['source']}],
                 'coldStart':{'model':False,'rules':False}} for case in data['cases']]
    baseline,candidate=rows(False),rows(True)
    manifest={'status':'completed','fingerprint':'fixture',
              'settings':{'corpus':module.digest(data),'split':'development',
                          'model':'same-model','runtime':{'python':'same-python'},
                          'implementation':{'service.py':'fixture-source'}}}
    def reference(rows,corrected):
        return {'resultsSHA256':module.digest(rows),'corpusSHA256':module.digest(data),
                'split':'development','missingResults':[],
                'casesScored':[{'id':case['id'],'group':case['group'],'track':case['track'],
                    'dialect':case['dialect'],'counts':{'tp':int(corrected and case['id']=='error'),
                    'fp':0,'fn':int(not corrected and case['id']=='error')}} for case in data['cases']]}
    args=[data,baseline,candidate,copy.deepcopy(manifest),copy.deepcopy(manifest),
          reference(baseline,False),reference(candidate,True)]
    return module,args,reference


def test_report_counts_delivered_corrections_and_keeps_qualification_boundary(study):
    module,args,_=study;result=module.matched(*args)
    assert result['remainingReferenceEditReduction']==1 and result['diagnosticTargetMet']
    assert result['status']=='measured-not-editorially-qualified'
    assert result['candidate']['maximumModelRequestsPerCase']==1


@pytest.mark.parametrize('defect',['missing-row','runtime','model','reference-hash','reference-missing-case','third-call'])
def test_changed_or_incomplete_evidence_cannot_pass(study,defect):
    module,args,_=study
    if defect=='missing-row':args[2].pop()
    elif defect=='runtime':args[4]['settings']['runtime']['python']='different'
    elif defect=='model':args[4]['settings']['model']='different'
    elif defect=='reference-hash':args[6]['resultsSHA256']='different'
    elif defect=='reference-missing-case':args[6]['casesScored'].pop()
    elif defect=='third-call':args[2][0]['modelTrace']*=3
    with pytest.raises(ValueError):module.matched(*args)


def test_new_protected_term_failure_vetoes_positive_reference_counts(study):
    module,args,reference=study
    args[2][0]['proposal']='The parcel was late.'
    args[6]=reference(args[2],True)  # Even optimistic overlap cannot hide a failed invariant.
    result=module.matched(*args)
    assert not result['diagnosticTargetMet']
    assert result['newLiteralCheckFailures']==[{'id':'error','checks':[{'kind':'protected','text':'files'}]}]


def test_quality_withhold_is_separate_from_runtime_failure_and_still_delivers_source(study):
    module,args,reference=study
    row=args[2][0]
    row.update(status='failed',serviceStatus='partial',displayed=False,
               warnings=[next(iter(module.QUALITY_WITHHOLD_WARNINGS))])
    assert module.quality_withhold(row) and module.delivered(row)==row['source']
    args[6]=reference(args[2],False)
    result=module.matched(*args)
    assert result['newServiceFailures']==[] and result['newQualityWithholds']==['error']
    assert not result['diagnosticTargetMet']  # No delivered correction, no gain.
    row['modelTrace'][0]['error']='RuntimeError'
    assert not module.quality_withhold(row)


def test_output_dependent_reference_choice_cannot_be_reported_as_error_reduction(study):
    module,args,_=study
    args[6]['casesScored'][0]['counts']['tp']=2
    result=module.matched(*args)
    assert result['referenceEditPopulations']=={'baseline':1,'candidate':2,'stable':False}
    assert result['remainingReferenceEditReduction'] is None and not result['diagnosticTargetMet']


def test_reference_aggregation_keeps_every_reference_and_cannot_be_mixed(study):
    import reference
    refs=['A valid correction.','Another valid correction.']
    assert reference.reference_groups(refs,'official-multi')==[refs]
    assert reference.reference_groups(refs,'all-independent')==[[refs[0]],[refs[1]]]
    with pytest.raises(ValueError):reference.reference_groups(refs,'best-after-seeing-candidate')
    module,args,_=study
    args[6]['referenceAggregation']='all-independent'
    with pytest.raises(ValueError,match='aggregation'):module.matched(*args)


def test_fresh_control_families_have_valid_dialect_and_utf16_fields(monkeypatch,tmp_path):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    controls=importlib.import_module('make_repair_controls');common=importlib.import_module('common')
    data=controls.build();common.write(tmp_path/'controls.json',data);common.corpus(tmp_path/'controls.json')
    assert len(data['cases'])==78 and len({case['group'] for case in data['cases']})==26
    for case in data['cases']:
        assert common.checks(case,case['reference'])==[]
        for span in case.get('languageRanges',[]):
            text=case['source'].encode('utf-16-le')[2*span['start']:2*span['end']].decode('utf-16-le')
            assert text=='[Budget 47 euros]'
