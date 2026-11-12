"""Carry unchanged public judgments into a repaired source-eligibility cohort.

No inference or retries. Verify the original frozen implementation/configuration,
the complete source-only population policy and every retained two-order verdict.
The original failed run remains immutable; known abstentions cannot be dropped.
"""
import argparse
import copy
from pathlib import Path

from common import read,records,digest,write,output_path
from peer_ranking import decision
from ranking_population import verify_manifest
from run import verify_archive


def fingerprint(pairs,config,archive):
    tool=Path(archive)/'scripts/developer/grammar'
    extra=config.get('implementationFiles',[])
    if any(Path(name).name!=name or not name.endswith('.py') for name in extra):
        raise ValueError('Invalid frozen judge dependency.')
    implementation={name:digest((tool/name).read_text('utf8'))
        for name in ('judge.py','judge_server.py','judge_client.py','judge_protocol.py','common.py',*extra)}
    rubric=read(tool/'rubric.json')
    return digest({'judge':config,'rubric':rubric,'implementation':implementation,
        'pairs':digest(pairs),'split':'validation','futilityProtocol':None}),digest(implementation),digest(rubric)


def reuse(old_pairs,new_pairs,ratings,config,archive,population):
    source=verify_archive(Path(archive));_,prepared,audit=verify_manifest(population)
    if (digest(old_pairs)!=audit['originalPairsSHA256'] or digest(new_pairs)!=audit['pairsSHA256']
            or digest(prepared)!=digest(new_pairs)):
        raise ValueError('Carry-over populations differ from the verified source-only policy.')
    identity=config.get('serverIdentity',{})
    if (config.get('sourceArchiveSHA256')!=source or identity.get('seedPolicy')!='fixed-per-request-v1'
        or identity.get('contextCachePolicy')!='reset-before-uncached-request'
        or identity.get('candidateOrdering')!='canonical-pair-v1'):
        raise ValueError('Reuse requires the exact frozen, request-independent judge profile.')
    if ratings.get('status') not in ('completed','interrupted','futile'):
        raise ValueError('Do not reuse invalidated, failed or still-running inference.')
    old_fp,implementation,rubric=fingerprint(old_pairs,config,archive)
    public={k:v for k,v in config.items() if k not in ('command','preflightCommand')}
    if (ratings.get('runFingerprint')!=old_fp or ratings.get('judgeSHA256')!=digest(config)
        or ratings.get('judge')!=public or ratings.get('implementationSHA256')!=implementation
        or ratings.get('rubricSHA256')!=rubric or ratings.get('requestedCases')!=len(old_pairs)):
        raise ValueError('Original ratings do not bind the declared implementation, input and judge.')
    original={p['id']:p for p in old_pairs};target={p['id']:p for p in new_pairs}
    if len(original)!=len(old_pairs) or len(target)!=len(new_pairs):raise ValueError('Duplicate pair identities.')
    excluded=set(audit['excludedUnratedOriginalSourceIndices'])
    for pair in old_pairs:
        if pair['sourceIndex'] not in excluded and target.get(pair['id'])!=pair:
            raise ValueError('An original human-eligible comparison changed or disappeared.')
        if pair['sourceIndex'] in excluded and pair['id'] in target:
            raise ValueError('The repaired population still contains an unrated original source.')
    kept=[];removed=[];seen=set();old_hash=digest(ratings)
    for row in ratings['records']:
        key=row['id']
        if key not in original or key in seen:raise ValueError('Unknown or duplicate original rating.')
        seen.add(key);winner=decision(row,original[key])
        if key not in target:
            if winner=='abstain':raise ValueError('A known abstention cannot be silently dropped during reuse.')
            removed.append(key);continue
        kept.append({**copy.deepcopy(row),'retainedRating':{'ratingsSHA256':old_hash,
            'recordSHA256':digest(row),'originalPairsSHA256':digest(old_pairs),'originalRunFingerprint':old_fp}})
    new_fp,_,_=fingerprint(new_pairs,config,archive)
    result={**ratings,'records':kept,'requestedCases':len(new_pairs),'status':'interrupted','runFingerprint':new_fp}
    proof={'protocol':'source-bound-public-rating-carryover-v1','sourceArchiveSHA256':source,
        'originalRatingsSHA256':old_hash,'originalPairsSHA256':digest(old_pairs),'pairsSHA256':digest(new_pairs),
        'populationManifestSHA256':digest(population),'judgeSHA256':digest(config),
        'retainedRatings':len(kept),'retainedAbstentions':sum(r['winner']=='abstain' for r in kept),
        'excludedUnratedRatings':len(removed),'excludedUnratedRatingIds':removed,
        'modelInferencePerformed':False,'scope':__doc__}
    return result,proof


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','config','original-pairs','pairs','ratings','population','output'):
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args();target=output_path(args.output)
    if target.exists() or Path(str(target)+'.continuation.json').exists():raise ValueError('Preserve previous results.')
    result,proof=reuse(records(args.original_pairs),records(args.pairs),read(args.ratings),read(args.config),
        args.source,read(args.population))
    write(target,result);write(str(target)+'.continuation.json',proof)
    print(__import__('json').dumps({k:proof[k] for k in ('retainedRatings','retainedAbstentions','excludedUnratedRatings','modelInferencePerformed')}))


if __name__=='__main__':main()
