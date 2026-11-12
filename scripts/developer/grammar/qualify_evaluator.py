"""Recompute local evaluator evidence; never infer, spend, tune or promote.

The product corpus/source binding identifies where this evaluator may be used.
Human agreement, semantic controls and ranking retain their separate populations.
Only reviewed weight identities can establish independent local model families.
"""
import argparse
from pathlib import Path

from common import digest, read, records, write, execution_stamp, require_unchanged
from judge import validate, adjudicate
from qualify import artifact_status
from run import verify_archive


IDENTITY_FIELDS=('modelSHA256','revision','baseFamily','sourceArchiveSHA256',
                 'serverIdentity','runtimeAssets','cpuRuntimeManifestSHA256')


def reviewed_family(config, review):
    matches=[row for row in review['developerEvaluatorCandidates']
             if row.get('sha256')==config.get('modelSHA256')]
    if len(matches)!=1 or not matches[0].get('baseFamily'):
        raise ValueError('A distinct profile name is not a reviewed model-family identity.')
    entry=matches[0]
    if config.get('baseFamily')!=entry['baseFamily']:
        raise ValueError('Judge family differs from the reviewed weight identity.')
    # Conservatively collapse sizes, dense/MoE and reasoning fine-tunes. New
    # profile names or sibling checkpoints cannot manufacture independence.
    name=entry['baseFamily'].casefold()
    for prefix,family in (('qwen','Qwen'),('google gemma','Gemma'),('mistral','Mistral'),
                          ('phi','Phi'),('llama','Llama')):
        if name.startswith(prefix):return family
    raise ValueError('Declare a reviewed independence policy for this model family.')


def bound_ratings(stage, source_hash, previous_identity=None):
    config=read(stage['config']);raw=read(stage['ratings'])
    public_config={key:value for key,value in config.items() if key not in ('command','preflightCommand')}
    if (config.get('sourceArchiveSHA256')!=source_hash or raw.get('judgeSHA256')!=digest(config)
            or raw.get('judge')!=public_config):
        raise ValueError('Ratings do not bind the verified source and declared judge configuration.')
    identity={key:config.get(key) for key in IDENTITY_FIELDS}
    if not identity['modelSHA256'] or not identity['serverIdentity']:
        raise ValueError('Local evaluator evidence needs a pinned model and server identity.')
    if identity['serverIdentity'].get('modelSHA256')!=identity['modelSHA256']:
        raise ValueError('Server identity differs from the declared model weights.')
    if config.get('referenceAssistedOnly') or identity['serverIdentity'].get('referenceAssistedOnly'):
        raise ValueError('Reference-assisted evidence cannot qualify an unreferenced evaluator.')
    if previous_identity is not None and identity!=previous_identity:
        raise ValueError('Evaluator stages used different inference profiles or sources.')
    return raw,config,identity


def readiness(pairs, raw):
    expected={pair['id']:pair for pair in pairs};seen=set()
    if not pairs or len(expected)!=len(pairs):raise ValueError('Invalid readiness population.')
    for row in raw['records']:
        pair=expected.get(row['id'])
        if pair is None or row['id'] in seen or row['pairSHA256']!=digest(pair):
            raise ValueError('Readiness result differs from its fixed control.')
        seen.add(row['id']);decisions=[]
        for swapped,response in enumerate(row.get('responses',[])):
            a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
            decisions.append(validate(response,pair['source'],a,b) if response is not None else 'abstain')
        if len(decisions)!=2 or decisions!=row.get('orderDecisions') or row['winner']!=adjudicate(*decisions):
            raise ValueError('Readiness decisions disagree with their public evidence.')
        if row['winner']!=pair['correctWinner']:return False
    return raw['status']=='completed' and raw['requestedCases']==len(pairs) and len(seen)==len(pairs)


def profile_passed(item):
    cal=item.get('calibration',{});val=item.get('validation',{})
    sem=item.get('semantics',{});rank=item.get('ranking',{})
    return bool(item.get('readinessPassed') and cal.get('publicEvidenceVerified')
        and cal.get('complete') and cal.get('agreement',0)>=.8
        and cal.get('abstentions',1)<=.1 and cal.get('orderInstability',1)<=.05
        and val.get('pairwiseGatePassed') and val.get('publicEvidenceVerified') and val.get('complete')
        and sem.get('status')=='passed' and sem.get('publicEvidenceVerified')
        and sem.get('inferenceStatus')=='completed' and sem.get('harmfulPreferences')==0
        and sem.get('orderInstability',1)<=.05
        and rank.get('status')=='passed' and rank.get('selectionVerified')
        and rank.get('humanPopulation',{}).get('populationAlignmentVerified') is True)


def combine(items, corpus_hash, product_source_hash):
    eligible=[item for item in items if profile_passed(item)]
    families={item['baseFamily'] for item in eligible}
    metrics={'qualifiedIndependentFamilies':len(families),
        'nonQwenFamilies':sum(not name.casefold().startswith('qwen') for name in families),
        'pairAgreementLower95':min((x['validation']['interval'][0] for x in eligible),default=0),
        'pairAgreement':min((x['validation']['agreement'] for x in eligible),default=0),
        'rankingSpearman':min((x['ranking']['spearman'] for x in eligible),default=0),
        'harmfulDetection':min((x['semantics']['detectionRate'] for x in eligible),default=0),
        'harmfulPreferences':sum(x['semantics']['harmfulPreferences'] for x in eligible),
        'publicEvidenceVerified':bool(eligible),
        'orderInstability':max((max(x[k]['orderInstability'] for k in ('calibration','validation','semantics')) for x in eligible),default=1),
        'abstentions':max((max(x[k]['abstentions'] for k in ('calibration','validation')) for x in eligible),default=1)}
    artifact={'protocol':'alder-grammar-gate-v2','gate':'evaluator','status':'passed',
        'corpusSHA256':corpus_hash,'implementationSHA256':product_source_hash,'metrics':metrics,
        'independentFamilies':sorted(families),'profiles':items,
        'scope':__doc__,'promotion':'none; evaluator qualification alone cannot select or ship a generator'}
    if artifact_status('evaluator',artifact)!='passed':artifact['status']='unverified'
    return artifact


def assess(manifest):
    from calibrate import calibrate
    from evaluate_semantics import evaluate as semantic_evaluate
    stamp={}
    for name in ('qualify_evaluator.py','qualify.py','calibrate.py','evaluate_semantics.py','peer_ranking.py','judge.py','run.py','common.py','human_rankings.py','ranking_population.py','reuse_ratings.py'):
        stamp.update(execution_stamp(Path(__file__).with_name(name)))
    cohort=records(manifest['cohort']);mapping=read(manifest['displayMap'])
    controls=records(manifest['controls']);semantics=records(manifest['semanticPairs'])
    product_source=verify_archive(Path(manifest['productSource']))
    review=read(manifest['modelReview']);items=[]
    for declared in manifest['judges']:
        source=verify_archive(Path(declared['source']))
        raw,config,identity=bound_ratings(declared['readiness'],source)
        family=reviewed_family(config,review)
        item={'baseFamily':family,'profileIdentitySHA256':digest(identity),
            'readinessPassed':readiness(controls,raw),'readinessRatingsSHA256':digest(raw)}
        for stage in ('calibration','validation'):
            if not declared.get(stage):continue
            raw,_,_=bound_ratings(declared[stage],source,identity)
            report=calibrate(cohort,raw,document_map=mapping,split=stage)
            population=[p for p in cohort if p['split']==stage]
            report['complete']=raw['status']=='completed' and raw['requestedCases']==len(population) and report['rated']==len(population)
            item[stage]=report
        if declared.get('semantics'):
            raw,_,_=bound_ratings(declared['semantics'],source,identity)
            if raw['requestedCases']!=len(semantics):raise ValueError('Semantic population was truncated.')
            item['semantics']=semantic_evaluate(semantics,raw)
        if declared.get('ranking'):
            from peer_ranking import evaluate as ranking_evaluate, verify_source
            verify_source(manifest['seeda'])
            raw,_,_=bound_ratings(declared['ranking'],source,identity)
            peer_pairs=records(manifest['peerPairs'])
            if raw['requestedCases']!=len(peer_pairs):raise ValueError('Ranking population was truncated.')
            if manifest.get('rankingPopulation'):
                from ranking_population import verify_manifest
                matrix,prepared,_=verify_manifest(read(manifest['rankingPopulation']))
                if digest(prepared)!=digest(peer_pairs) or digest(matrix)!=digest(records(manifest['rankingMatrix'])):
                    raise ValueError('Ranking inputs differ from the declared full human-rated population.')
            continuation=declared['ranking'].get('continuation')
            if continuation:
                from reuse_ratings import reuse
                initial,proof=reuse(records(continuation['originalPairs']),peer_pairs,
                    read(continuation['originalRatings']),read(declared['ranking']['config']),
                    declared['source'],read(manifest['rankingPopulation']))
                if proof!=read(continuation['proof']):raise ValueError('Ranking carry-over proof changed.')
                retained={row['id']:row for row in initial['records']}
                current={row['id']:row for row in raw['records']}
                if any(current.get(key)!=row for key,row in retained.items()) or any(
                        'retainedRating' in row and row['id'] not in retained for row in raw['records']):
                    raise ValueError('A retained public ranking judgment changed or disappeared.')
            selection={'matrix':records(manifest['rankingMatrix']),'rawMap':read(manifest['rawMap']),
                'displayMap':mapping,'cohort':cohort}
            item['ranking']=ranking_evaluate(peer_pairs,raw,manifest['seeda'],selection)
        item['profileQualified']=profile_passed(item);items.append(item)
    result=combine(items,digest(read(manifest['productCorpus'])),product_source)
    require_unchanged(stamp)
    result.update(manifestSHA256=digest(manifest),assemblyImplementationSHA256=digest(stamp),
        humanCohortSHA256=digest(cohort),semanticPairsSHA256=digest(semantics),modelReviewSHA256=digest(review))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();write(args.output,assess(read(args.manifest)))


if __name__=='__main__':main()
