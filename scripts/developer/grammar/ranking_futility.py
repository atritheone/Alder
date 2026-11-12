"""Reject a peer-ranking run only when its frozen source-coverage gate is impossible.

Unqueried comparisons are optimistically decisive. This cannot qualify a judge,
estimate final correlation or justify changing the frozen source population.
"""
from common import digest
from peer_ranking import shape, decision


def assess(pairs, rows):
    sources,_=shape(pairs)
    if len(sources)<100:raise ValueError('Use the full declared ranking population, at least 100 sources.')
    expected={pair['id']:pair for pair in pairs};seen=set();incomplete=set()
    for row in rows:
        key=row['id']
        if key not in expected or key in seen:
            raise ValueError('Unknown or duplicate peer-ranking result.')
        seen.add(key);pair=expected[key]
        if row.get('pairSHA256')!=digest(pair):raise ValueError('Peer-ranking comparison changed.')
        if decision(row,pair)=='abstain':incomplete.add(pair['sourceIndex'])
    possible=len(sources)-len(incomplete);reasons=[]
    if possible<100:reasons.append('Even perfect remaining ratings leave fewer than 100 complete matched sources.')
    if 10*possible<9*len(sources):reasons.append('Even perfect remaining ratings cannot reach 90% complete-source coverage.')
    return {'protocol':'peer-ranking-coverage-futility-v1','futile':bool(reasons),'reasons':reasons,
        'requestedComparisons':len(pairs),'recordedComparisons':len(seen),
        'totalSources':len(sources),'observedIncompleteSources':len(incomplete),
        'bestPossibleCompleteSources':possible,'bestPossibleSourceCoverage':possible/len(sources),
        'scope':__doc__}
