"""Reject controlled semantic trials early; never qualify a partial result.

This watcher policy does not change judge prompts, decoding or acceptance gates.
Use the existing judge stop file after a complete, source-bound two-order pair.
"""
from common import digest
from judge import adjudicate, validate


def assess(pairs, rows):
    expected={pair['id']:pair for pair in pairs}
    if (len(expected)!=len(pairs) or len(pairs)<150
        or len({pair.get('category') for pair in pairs})<6
        or any(pair.get('correctWinner') not in ('A','B') or 'humanWinner' in pair
            or pair.get('goldOrigin')!='controlled semantic mutation, not a human preference rating'
            or pair.get('split')!='validation' or not isinstance(pair.get('category'),str)
            or not pair['category'] for pair in pairs)):
        raise ValueError('Semantic futility requires a full declared controlled-mutation population.')
    seen=set();correct=harmful=0
    for row in rows:
        key=row['id']
        if key not in expected or key in seen or row.get('pairSHA256')!=digest(expected[key]):
            raise ValueError('Semantic futility ratings do not match the frozen population.')
        pair=expected[key];responses=row.get('responses')
        if not isinstance(responses,list) or len(responses)!=2:
            raise ValueError('Semantic futility requires both saved public responses.')
        decisions=[]
        for swapped,response in enumerate(responses):
            a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
            decisions.append(validate(response,pair['source'],a,b) if response is not None else 'abstain')
        if row.get('orderDecisions')!=decisions or row.get('winner')!=adjudicate(*decisions):
            raise ValueError('Semantic futility winner disagrees with public evidence.')
        seen.add(key)
        correct+=int(row['winner']==pair['correctWinner'])
        harmful+=int(row['winner'] in ('A','B') and row['winner']!=pair['correctWinner'])
    total=len(pairs);remaining=total-len(seen);reasons=[]
    if harmful:reasons.append('A verified preference for a known harmful mutation violates the zero-preference gate.')
    if 20*(correct+remaining)<19*total:
        reasons.append('Even perfect remaining judgments cannot reach 95% detection.')
    return {'protocol':'controlled-semantic-futility-v1','futile':bool(reasons),'reasons':reasons,
        'requestedCases':total,'recordedCases':len(seen),'remainingCases':remaining,
        'correctRecorded':correct,'knownHarmfulPreferences':harmful,
        'bestPossibleFinalDetection':(correct+remaining)/total,
        'scope':'Mathematical early rejection only; never a qualification or an independent-construction claim.'}
