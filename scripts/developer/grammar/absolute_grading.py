"""Calibrate dimension-specific approval against published human ratings.

Unanimous non-Other top ratings define the strict positive class. This is a
different task from preferring one imperfect edit to another. Source-sentence
splits do not establish essay-disjoint or genre-wide qualification.
"""
import argparse
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
from common import read,records,write,digest,output_path
from compare import interval


def prepare(root,dimension='grammar'):
    if dimension not in ('grammar','meaning'):raise ValueError('Unsupported human rating dimension.')
    annotation,average=('grammer','ave_g') if dimension=='grammar' else ('meaning','ave_m')
    if subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip():
        raise ValueError('Human-rating checkout has unrecorded changes.')
    revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    path=root/'tmu-gfm-dataset.csv';unique={}
    with path.open(encoding='utf-8',newline='') as stream:
        for row in csv.DictReader(stream):
            votes=[int(value) for value in row[annotation].split(',')]
            if len(votes)!=5 or any(not 0<=value<=4 for value in votes):raise ValueError('Invalid human '+dimension+' votes.')
            eligible=[value for value in votes if value]
            mean=float(row[average])
            if len(eligible)<3 or not math.isfinite(mean) or abs(mean-sum(eligible)/len(eligible))>1e-6:
                raise ValueError('Human mean differs from non-Other votes.')
            key=digest([row['source'],row['output']]);group=digest(re.sub(r'\W+','',row['source'].casefold()))
            if key not in unique:
                unique[key]={'id':'absolute-'+key[:24],'group':group,
                  'split':'calibration' if int(group[:8],16)%5<3 else 'validation',
                  'source':row['source'],'a':row['output'],'b':row['output'],
                  'humanFullyCorrect':True,'humanRecordCount':0,'humanMeans':[],'humanRatingDimension':dimension}
            case=unique[key];case['humanFullyCorrect'] &= all(value==4 for value in eligible)
            case['humanRecordCount']+=1;case['humanMeans'].append(mean)
    return sorted(unique.values(),key=lambda case:case['id']),{
      'datasetOrigin':'TMU-GFM','sourceDatasetOrigins':['CoNLL-2013'],
      'revision':revision,'csvSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),
      'labelPolicy':'Strict positive only when every eligible original record has all non-Other '+dimension+' votes 4; duplicates are not independent votes',
      'scope':'Published human-rating analysis only; no data redistribution or training permission asserted'}


def rebind_scores(previous,updated,ratings):
    """Change human labels only; never pretend changed model inputs were scored."""
    if ratings['judge'].get('family')!='deberta-v3-reward':raise ValueError('Only the documented SURE input contract supports this conversion.')
    a={case['id']:case for case in previous};b={case['id']:case for case in updated}
    if len(a)!=len(previous) or len(b)!=len(updated) or a.keys()!=b.keys():raise ValueError('Label conversion changed the population.')
    labels={'humanFullyCorrect','humanMeans','humanRatingDimension'}
    for key in a:
        if {k:v for k,v in a[key].items() if k not in labels}!={k:v for k,v in b[key].items() if k not in labels}:
            raise ValueError('Label conversion changed model inputs or partition identity.')
    rows=[];seen=set()
    for row in ratings['records']:
        key=row['id']
        if key not in a or key in seen or row['pairSHA256']!=digest(a[key]):raise ValueError('Unbound original metric rating.')
        seen.add(key);rows.append({**row,'pairSHA256':digest(b[key])})
    if seen!=a.keys():raise ValueError('Original metric population is incomplete.')
    return {**ratings,'records':rows,'derivation':{'operation':'Reuse unchanged SURE source/output scores under separately published human dimension labels; no new inference',
      'originalPairsSHA256':digest(previous),'updatedPairsSHA256':digest(updated),'originalRatingsSHA256':digest(ratings),
      'implementationSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}}


def population(pairs,ratings,axis):
    dimension={'grammaticality':'grammar','faithfulness':'meaning'}[axis]
    if any(case.get('humanRatingDimension','grammar')!=dimension for case in pairs):raise ValueError('Human and metric dimensions do not match.')
    overlap=set(ratings['judge'].get('trainingDatasetOrigins',[]))&{'CoNLL-2013','TMU-GFM'}
    if overlap:raise ValueError('Known supervised training-source overlap prevents independent absolute calibration.')
    expected={case['id']:case for case in pairs}
    if len(expected)!=len(pairs):raise ValueError('Duplicate absolute-rating case.')
    if any(type(case['humanFullyCorrect']) is not bool for case in pairs):raise ValueError('Absolute human labels must be boolean.')
    predictions={}
    for row in ratings['records']:
        if row['id'] in predictions or row['id'] not in expected or row['pairSHA256']!=digest(expected[row['id']]):
            raise ValueError('Unknown, duplicate or changed absolute-rating input.')
        value=row['dimensions'][0]
        score=value[axis] if value is not None else None
        if score is not None and (type(score) not in (int,float) or not math.isfinite(score)):
            raise ValueError('Nonfinite or nonnumeric absolute score.')
        predictions[row['id']]=score
    return [(case,predictions.get(case['id'])) for case in pairs]


def summarize(examples,threshold):
    selected=[case for case,value in examples if value is not None and value>=threshold]
    groups=defaultdict(list)
    for case in selected:groups[case['group']].append(int(case['humanFullyCorrect']))
    correct=sum(case['humanFullyCorrect'] for case in selected)
    return {'cases':len(examples),'scored':sum(value is not None for _,value in examples),
      'approved':len(selected),'approvedSourceGroups':len(groups),'supportedApprovals':correct,
      'approvalAgreementWithUnanimousHumanRatings':correct/len(selected) if selected else None,
      'approvalRate':len(selected)/len(examples) if examples else 0,
      'sourceBootstrap95':interval(groups,iterations=4000),
      'unsupportedApprovalIds':[case['id'] for case in selected if not case['humanFullyCorrect']]}


def coverage_feasibility(pairs):
    """A population bound, independent of any metric scores or fitted cutoff."""
    if any(type(case.get('humanFullyCorrect')) is not bool for case in pairs):
        raise ValueError('Absolute human labels must be boolean.')
    folds=defaultdict(list)
    for case in pairs:folds[case['split']].append(case)
    result={}
    for split,cases in folds.items():
        positives=sum(case['humanFullyCorrect'] for case in cases)
        maximum=min(len(cases),positives*20//19)
        result[split]={'cases':len(cases),'unanimousTopCases':positives,
          'positiveSourceGroups':len({case['group'] for case in cases if case['humanFullyCorrect']}),
          'maximumOracleApprovalsAt95Precision':maximum,'requiredApprovals':100,
          'caseCountAllowsCoverage':maximum>=100,
          'limitation':'Necessary class-count condition only; does not establish source-group coverage, evaluator performance or validity of nonpositive sentences.'}
    return {'status':'unverified','pairsSHA256':digest(pairs),'folds':result,
      'scope':'Strict unanimous-top label population feasibility before evaluator fitting; no quality gate or human label changed.'}


def fit(pairs,ratings,axis):
    examples=[row for row in population(pairs,ratings,axis) if row[0]['split']=='calibration']
    best=None;most=0;best_precision=None;best_eligible_threshold=None
    for threshold in sorted({value for _,value in examples if value is not None}):
        selected=[case for case,value in examples if value is not None and value>=threshold]
        correct=sum(case['humanFullyCorrect'] for case in selected)
        eligible=len(selected)>=100 and len({case['group'] for case in selected})>=35
        precision=correct/len(selected) if selected else 0
        if eligible and (best_precision is None or precision>best_precision):
            best_precision=precision;best_eligible_threshold=threshold
        if eligible and precision>=.95 and len(selected)>most:best=threshold;most=len(selected)
    return {'status':'unverified','threshold':best,'axis':axis,'fitSplit':'calibration',
      'calibration':summarize(examples,best) if best is not None else None,
      'pairsSHA256':digest(pairs),'judgeSHA256':digest(ratings['judge']),
      'ratingImplementationSHA256':ratings.get('implementationSHA256'),
      'approvalImplementationSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'diagnostics':{'maximumCalibrationPrecisionAtRequiredCoverage':best_precision,
                     'bestEligibleCalibrationThreshold':best_eligible_threshold,
                     'scope':'Calibration diagnosis only; does not change the frozen approval target or evaluate alternate thresholds on validation'},
      'scope':__doc__,'qualification':'Threshold fitting is not held-out approval qualification.'}


def evaluate(pairs,ratings,policy):
    if policy.get('approvalImplementationSHA256')!=hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
        raise ValueError('Absolute-rating approval implementation changed.')
    if policy['pairsSHA256']!=digest(pairs) or policy['judgeSHA256']!=digest(ratings['judge']) or policy['ratingImplementationSHA256']!=ratings.get('implementationSHA256'):
        raise ValueError('Absolute-rating policy has a different corpus, judge or implementation.')
    examples=[row for row in population(pairs,ratings,policy['axis']) if row[0]['split']=='validation']
    result=summarize(examples,policy['threshold']) if policy['threshold'] is not None else None
    return {'status':'unverified','analyzedSplit':'validation','policySHA256':digest(policy),
      'threshold':policy['threshold'],'metrics':result,'scope':__doc__,
      'pointTargetMet':bool(result and result['approved']>=100 and result['approvedSourceGroups']>=35 and result['approvalAgreementWithUnanimousHumanRatings']>=.95),
      'limitations':['Original source-essay alignment and document-disjoint calibration audit are unavailable.',
        'Human rating unanimity is the strict positive class; other outputs are not automatically proven ungrammatical.',
        'No meaning, dialect, creative-voice or production redistribution qualification.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('prepare');p.add_argument('--dataset',type=Path,required=True)
    p.add_argument('--human-dimension',choices=['grammar','meaning'],default='grammar')
    p=sub.add_parser('rebind');p.add_argument('--pairs',required=True);p.add_argument('--updated-pairs',required=True);p.add_argument('--ratings',required=True)
    p=sub.add_parser('feasibility');p.add_argument('--pairs',required=True)
    for action in ('fit','evaluate'):
        command=sub.add_parser(action);command.add_argument('--pairs',required=True);command.add_argument('--ratings',required=True)
        if action=='fit':command.add_argument('--axis',required=True,choices=['grammaticality','faithfulness'])
        else:command.add_argument('--policy',required=True)
    for command in sub.choices.values():command.add_argument('--output',required=True)
    args=parser.parse_args()
    if args.action=='prepare':
        cases,origin=prepare(args.dataset,args.human_dimension);target=output_path(args.output)
        target.write_text(''.join(json.dumps(case,ensure_ascii=False)+'\n' for case in cases),'utf-8')
        write(str(target)+'.manifest.json',{'cases':len(cases),'pairsSHA256':digest(cases),'origin':origin})
        print(json.dumps({'cases':len(cases),'groups':len({case['group'] for case in cases})}));return
    if args.action=='rebind':
        write(args.output,rebind_scores(records(args.pairs),records(args.updated_pairs),read(args.ratings)))
        print('Reused unchanged model inputs; human dimension labels explicitly rebound.');return
    if args.action=='feasibility':
        report=coverage_feasibility(records(args.pairs));write(args.output,report)
        print(json.dumps(report['folds']));return
    pairs=records(args.pairs);ratings=read(args.ratings)
    result=fit(pairs,ratings,args.axis) if args.action=='fit' else evaluate(pairs,ratings,read(args.policy))
    write(args.output,result)
    print(json.dumps({key:result[key] for key in ('status','threshold')}))


if __name__=='__main__':main()
