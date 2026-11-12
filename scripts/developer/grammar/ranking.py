"""Equal-source system ranking against human TrueSkill on the same held-out fold."""
import argparse
from collections import defaultdict
import json
import math
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
from common import records,read,digest,write,output_path,execution_stamp,require_unchanged
from human_rankings import source_indices,matched_sources


def rating_score(row,pair):
    """A comparative score is the validated win rate against this matrix's source."""
    if 'winner' in row:
        from judge import validate,adjudicate
        if pair['b']!=pair['source']:raise ValueError('Comparative ranking requires the original source anchor.')
        if 'scores' in row or 'dimensions' in row:raise ValueError('Ambiguous ranking score protocol.')
        responses=row.get('responses',[])
        if len(responses)!=2 or len(row.get('orderDecisions',[]))!=2:
            raise ValueError('Comparative ranking requires both saved orders.')
        decisions=[]
        for swapped,response in enumerate(responses):
            a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
            decision=validate(response,pair['source'],a,b) if response is not None else 'abstain'
            decisions.append(decision)
        if decisions!=row['orderDecisions'] or adjudicate(*decisions)!=row['winner']:
            raise ValueError('Comparative ranking decision disagrees with its evidence.')
        return {'A':1.0,'B':0.0,'tie':.5,'abstain':None}[row['winner']]
    score=row.get('scores',[None])[0] if 'scores' in row else (row.get('dimensions',[None])[0] or {}).get('overall')
    if score is not None and (type(score) not in (float,int) or not math.isfinite(score)):
        raise ValueError('Nonfinite or nonnumeric ranking score.')
    return score


def prepare(args):
    cohort=records(args.cohort)
    # Display-normalized cohorts retain their exact raw benchmark identity.
    # Ranking preparation reads raw system files; normalize the resulting
    # matrix separately rather than matching rendered hashes to raw sources.
    groups={p.get('originalGroup',p['group']) for p in cohort if p['split']=='validation'}
    source=(args.seeda/'outputs/all/INPUT.txt').read_text('utf-8').splitlines()
    outputs={p.stem:p.read_text('utf-8').splitlines() for p in (args.seeda/'outputs/all').glob('*.txt')}
    if len(outputs)!=15 or any(len(values)!=len(source) for values in outputs.values()):
        raise ValueError('Unexpected SEEDA system inventory/alignment.')
    if not groups or not groups<={digest(text) for text in source}:
        raise ValueError('Ranking cohort contains missing raw source identities.')
    pairs=[]
    for index,text in enumerate(source):
        group=digest(text)
        if group not in groups:continue
        for name,lines in sorted(outputs.items()):
            pairs.append({'id':'rank-'+digest([index,name])[:24],'group':group,'split':'validation',
              'source':text,'sourceIndex':index,'system':name,'a':lines[index],'b':text})
    target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():
        raise ValueError('Preserve the frozen ranking matrix; use a new output path.')
    target.write_text(''.join(json.dumps(pair,ensure_ascii=False)+'\n' for pair in pairs),'utf-8')
    write(str(target)+'.manifest.json',{'cohortSHA256':digest(cohort),'matrixSHA256':digest(pairs),
      'groups':len(groups),'systems':sorted(outputs),'pairs':len(pairs),'scope':__doc__})
    print(json.dumps({'pairs':len(pairs),'groups':len(groups)}))


def evaluate(args):
    import trueskill
    from scipy.stats import spearmanr
    stamp={**execution_stamp(__file__),**execution_stamp(Path(__file__).with_name('judge.py')),
           **execution_stamp(Path(__file__).with_name('human_rankings.py'))}
    pairs=records(args.pairs);ratings=read(args.ratings)
    expected={p['id']:p for p in pairs}
    if len(expected)!=len(pairs):raise ValueError('Duplicate ranking ids.')
    matrix=defaultdict(dict);seen=set();protocols=set()
    for row in ratings['records']:
        if row['id'] not in expected or row['id'] in seen:raise ValueError('Unknown or duplicate ranking rating.')
        seen.add(row['id']);pair=expected[row['id']]
        if row['pairSHA256']!=digest(pair):raise ValueError('Ranking input changed after scoring.')
        protocols.add('two-order-source-anchor-win-rate-v1' if 'winner' in row else 'numeric-quality-score-v1')
        if len(protocols)>1:raise ValueError('Do not mix ranking score protocols.')
        score=rating_score(row,pair)
        if pair['system'] in matrix[pair['sourceIndex']]:raise ValueError('Duplicate source/system ranking cell.')
        matrix[pair['sourceIndex']][pair['system']]=score
    systems=sorted({p['system'] for p in pairs});all_sources={p['sourceIndex'] for p in pairs}
    complete={index for index in all_sources if len(matrix[index])==len(systems) and all(v is not None for v in matrix[index].values())}
    env=trueskill.TrueSkill()
    human={name:env.create_rating() for name in systems};counts=defaultdict(int)
    human_data=(args.seeda/'data/judgments_sent.xml').read_bytes()
    items=list(ET.fromstring(human_data).iter('ranking-item'))
    source_count=len((args.seeda/'outputs/all/INPUT.txt').read_text('utf8').splitlines())
    complete,population=matched_sources(all_sources,complete,source_indices(items,source_count))
    for item in items:
        if int(item.attrib['src-id'])-1 not in complete:continue
        names=[];ranks=[]
        for translation in item:
            for name in translation.attrib['system'].split():
                if name in human:names.append(name);ranks.append(int(translation.attrib['rank']))
        if len(names)<2:continue
        updated=env.rate([(human[name],) for name in names],ranks=ranks)
        for name,team in zip(names,updated):human[name]=team[0];counts[name]+=1
    scores={name:sum(matrix[index][name] for index in complete)/len(complete) for name in systems} if complete else {}
    correlation=float(spearmanr([scores[name] for name in systems],[human[name].mu for name in systems]).statistic) if complete else None
    if correlation is not None and not math.isfinite(correlation):correlation=None
    coverage=population['coverage']
    passed=population['populationAlignmentVerified'] and correlation is not None and correlation>=.85 and coverage>=.9 and len(complete)>=100 and all(counts[name] for name in systems)
    require_unchanged(stamp)
    write(args.output,{'status':'passed' if passed else 'unverified','scope':__doc__,
      'spearman':correlation,'completeSources':len(complete),'totalSources':len(all_sources),'coverage':coverage,
      'systems':{name:{'metric':scores.get(name),'humanMu':human[name].mu,'humanComparisons':counts[name]} for name in systems},
      'matrixSHA256':digest(pairs),'ratingsSHA256':digest(ratings),'implementationSHA256':digest(stamp),
      'humanJudgmentsSHA256':hashlib.sha256(human_data).hexdigest(),
      'scoreProtocol':next(iter(protocols),None),
      'comparativeLimitation':'Source-anchor win rates can saturate and cannot establish absolute editorial approval.',
      'humanPopulation':population,
      'judge':ratings['judge'],'trueskillVersion':trueskill.__version__})
    print(json.dumps({'spearman':correlation,'coverage':coverage,'sources':len(complete)}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('prepare');p.add_argument('--cohort',required=True)
    q=sub.add_parser('evaluate');q.add_argument('--pairs',required=True);q.add_argument('--ratings',required=True)
    for command in (p,q):command.add_argument('--seeda',type=Path,required=True);command.add_argument('--output',required=True)
    args=parser.parse_args();prepare(args) if args.action=='prepare' else evaluate(args)


if __name__=='__main__':main()
