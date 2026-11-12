"""Rejection-only bounds for a frozen human-validation population.

This does not change the calibrated model or permit tuning on held-out verdicts.
Unqueried cases receive the most optimistic possible outcome for these bounds.
"""
from common import digest
from judge import adjudicate,validate


def assess(pairs,rows):
    expected={pair['id']:pair for pair in pairs}
    if (len(expected)!=len(pairs) or len(pairs)<100
        or any(pair.get('split')!='validation' or pair.get('humanWinner') not in ('A','B')
            or 'correctWinner' in pair for pair in pairs)):
        raise ValueError('Validation futility requires the full decisive human-validation population.')
    seen=set();correct=abstentions=changes=0
    reverse={'A':'B','B':'A','tie':'tie','abstain':'abstain'}
    for row in rows:
        key=row['id']
        if key not in expected or key in seen or row.get('pairSHA256')!=digest(expected[key]):
            raise ValueError('Validation futility ratings do not match the frozen population.')
        pair=expected[key];responses=row.get('responses')
        if not isinstance(responses,list) or len(responses)!=2:
            raise ValueError('Validation futility requires both saved public responses.')
        decisions=[]
        for swapped,response in enumerate(responses):
            a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
            decisions.append(validate(response,pair['source'],a,b) if response is not None else 'abstain')
        if row.get('orderDecisions')!=decisions or row.get('winner')!=adjudicate(*decisions):
            raise ValueError('Validation futility winner disagrees with public evidence.')
        seen.add(key);correct+=int(row['winner']==pair['humanWinner'])
        abstentions+=int(row['winner']=='abstain');changes+=int(decisions[0]!=reverse[decisions[1]])
    total=len(pairs);remaining=total-len(seen);reasons=[]
    if 5*(correct+remaining)<4*total:reasons.append('Even perfect remaining judgments cannot reach 80% agreement.')
    if 10*abstentions>total:reasons.append('Observed abstentions already exceed 10% of the full population.')
    if 20*changes>total:reasons.append('Observed order changes already exceed 5% of the full population.')
    return {'protocol':'human-validation-futility-v1','futile':bool(reasons),'reasons':reasons,
        'requestedCases':total,'recordedCases':len(seen),'remainingCases':remaining,
        'correctRecorded':correct,'bestPossibleFinalAgreement':(correct+remaining)/total,
        'minimumFinalAbstentionRate':abstentions/total,'minimumFinalOrderInstability':changes/total,
        'scope':'Mathematical rejection only; never qualification, a confidence-bound substitute or permission to tune on held-out results.'}
