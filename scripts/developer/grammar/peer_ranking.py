"""Blinded peer-system ranking on the already frozen held-out source inventory.

Each source has a fixed hash-ordered cycle: every system faces two peers. Unlike
an unchanged-source star, this measures preferences between competing editors.
The cycle is fixed before inference, with no seed or outcome-based opponent search.
"""
import argparse
from collections import Counter,defaultdict
import hashlib
import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from common import read,records,write,digest,output_path,execution_stamp,require_unchanged
from conll_documents import compact,source_clusters
from contextualize_pairs import contextualize,SEEDA_REVISION
from judge import validate,adjudicate
from human_rankings import source_indices,matched_sources

PROTOCOL='source-balanced-peer-cycle-v1'


def verify_source(seeda):
    revision=subprocess.check_output(['git','-C',str(seeda),'rev-parse','HEAD'],text=True).strip()
    dirty=subprocess.check_output(['git','-C',str(seeda),'status','--porcelain'],text=True).strip()
    if revision!=SEEDA_REVISION or dirty:
        raise ValueError('Use the pinned, unchanged published SEEDA source.')
    return revision


def prepare(matrix,raw_map,display_map,outputs,cohort):
    systems=set(outputs)
    if len(systems)!=15 or 'INPUT' not in systems:raise ValueError('Use the complete published 15-system inventory.')
    clusters=source_clusters(display_map);folds=defaultdict(set)
    for pair in cohort:
        if pair['split'] not in ('calibration','validation'):raise ValueError('Unknown judge partition.')
        folds[pair['split']].add(clusters[digest(pair['source'])])
    if not folds['calibration'] or not folds['validation'] or folds['calibration']&folds['validation']:
        raise ValueError('Ranking requires the frozen, disjoint judge document folds.')
    sources=defaultdict(dict)
    for row in matrix:
        i=row['sourceIndex'];name=row['system']
        if (type(i) is not int or not 0<=i<len(display_map['sentences']) or name not in systems
            or row['split']!='validation' or row['b']!=row['source'] or row['group']!=digest(row['source'])
            or row['source']!=display_map['sentences'][i]['source']
            or compact(row['a'])!=compact(outputs[name][i])
            or any(field in row for field in ('humanWinner','humanVotes','correctWinner','humanEditsAcceptable'))):
            raise ValueError('Unlabelled ranking cell differs from its published source/output identity.')
        if clusters[digest(row['source'])] not in folds['validation']:
            raise ValueError('Ranking source is not in the already frozen validation documents.')
        if name in sources[i]:raise ValueError('Duplicate source/system ranking cell.')
        sources[i][name]=row
    pairs=[]
    for i,cells in sorted(sources.items()):
        if set(cells)!=systems:raise ValueError('Do not drop systems or incomplete source inventories.')
        cycle=sorted(systems,key=lambda name:digest([PROTOCOL,i,name]))
        for position,left in enumerate(cycle):
            right=cycle[(position+1)%len(cycle)];source=cells[left]['source']
            pairs.append({'id':digest([i,left,right])[:24],'sourceIndex':i,'source':source,'group':digest(source),
                'split':'validation','documentGroup':clusters[digest(source)],'systems':[left,right],
                'a':cells[left]['a'],'b':cells[right]['a'],'rankingProtocol':PROTOCOL,
                'parentMatrixRowsSHA256':[digest(cells[left]),digest(cells[right])]})
    return contextualize(pairs,raw_map,display_map,outputs)


def shape(pairs):
    sources=defaultdict(list);ids=set();all_systems=None
    for pair in pairs:
        names=pair.get('systems')
        if (pair.get('rankingProtocol')!=PROTOCOL or pair.get('split')!='validation'
            or not isinstance(names,list) or len(names)!=2 or names[0]==names[1]
            or any(not isinstance(name,str) or not name for name in names)
            or pair['id']!=digest([pair['sourceIndex'],*names])[:24] or pair['id'] in ids):
            raise ValueError('Invalid peer ranking comparison identity.')
        ids.add(pair['id']);sources[pair['sourceIndex']].append(pair)
    if not sources:raise ValueError('Ranking matrix is empty.')
    for comparisons in sources.values():
        if any(pair['source']!=comparisons[0]['source'] or pair['group']!=digest(pair['source']) for pair in comparisons):
            raise ValueError('A source index has inconsistent original text or grouping.')
        nodes={name for pair in comparisons for name in pair['systems']};edges=set();degree=Counter();graph=defaultdict(set)
        if len(nodes)!=15 or len(comparisons)!=15:raise ValueError('Each source needs the complete 15-edge peer cycle.')
        if all_systems is not None and nodes!=all_systems:raise ValueError('Ranking system inventories differ by source.')
        all_systems=nodes
        for pair in comparisons:
            a,b=pair['systems'];edge=tuple(sorted((a,b)))
            if edge in edges:raise ValueError('Repeated peer edge.')
            edges.add(edge);degree.update((a,b));graph[a].add(b);graph[b].add(a)
        if set(degree.values())!={2}:raise ValueError('Each system must face exactly two peers per source.')
        reached=set();pending=[min(nodes)]
        while pending:
            node=pending.pop()
            if node in reached:continue
            reached.add(node);pending.extend(graph[node]-reached)
        if reached!=nodes:raise ValueError('Peer graph is disconnected.')
    return dict(sources),sorted(all_systems)


def decision(row,pair):
    if row['pairSHA256']!=digest(pair):raise ValueError('Peer input changed after inference.')
    responses=row.get('responses',[])
    if len(responses)!=2 or len(row.get('orderDecisions',[]))!=2:raise ValueError('Both saved peer orders are required.')
    choices=[]
    for swapped,response in enumerate(responses):
        a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
        choices.append(validate(response,pair['source'],a,b) if response is not None else 'abstain')
    if choices!=row['orderDecisions'] or row['winner']!=adjudicate(*choices):raise ValueError('Peer winner disagrees with public evidence.')
    return row['winner']


def verify_selection(pairs,matrix,raw_map,display_map,outputs,cohort):
    expected=prepare(matrix,raw_map,display_map,outputs,cohort)
    if digest(pairs)!=digest(expected):
        raise ValueError('Peer matrix differs from its frozen source selection, context or cycle.')
    return {'parentMatrixSHA256':digest(matrix),'cohortSHA256':digest(cohort),
        'documentMapSHA256':digest(raw_map),'displayMapSHA256':digest(display_map),
        'calibrationDocumentOverlap':0}


def evaluate(pairs,ratings,seeda,selection=None):
    import scipy,trueskill
    from scipy.stats import spearmanr
    code={}
    for name in ('peer_ranking.py','judge.py','common.py','contextualize_pairs.py','conll_documents.py','human_rankings.py'):
        code.update(execution_stamp(Path(__file__).with_name(name)))
    sources,systems=shape(pairs);expected={p['id']:p for p in pairs};outcomes={}
    published={path.stem:path.read_text('utf8').splitlines() for path in (Path(seeda)/'outputs/all').glob('*.txt')}
    if set(published)!=set(systems):raise ValueError('Published ranking system inventory changed.')
    selection_audit=verify_selection(pairs,selection['matrix'],selection['rawMap'],selection['displayMap'],
        published,selection['cohort']) if selection is not None else None
    for pair in pairs:
        i=pair['sourceIndex']
        if type(i) is not int or not 0<=i<len(published['INPUT']) or compact(pair['source'])!=compact(published['INPUT'][i]):
            raise ValueError('Peer source is not the published original at this index.')
        if any(i>=len(published[name]) or compact(pair[field])!=compact(published[name][i])
            for field,name in zip(('a','b'),pair['systems'])):
            raise ValueError('Peer candidate is not the published system output.')
    for row in ratings['records']:
        if row['id'] not in expected or row['id'] in outcomes:raise ValueError('Unknown or duplicate peer rating.')
        outcomes[row['id']]=decision(row,expected[row['id']])
    complete={i for i,rows in sources.items() if all(outcomes.get(p['id'],'abstain')!='abstain' for p in rows)}
    human_data=(Path(seeda)/'data/judgments_sent.xml').read_bytes()
    human_items=list(ET.fromstring(human_data).iter('ranking-item'))
    complete,population=matched_sources(sources,complete,source_indices(human_items,len(published['INPUT'])))
    env=trueskill.TrueSkill();model={name:env.create_rating() for name in systems};human={name:env.create_rating() for name in systems}
    model_counts=Counter();human_counts=Counter()
    for i in sorted(complete):
        for pair in sources[i]:
            a,b=pair['systems'];winner=outcomes[pair['id']]
            ranks=[0,1] if winner=='A' else [1,0] if winner=='B' else [0,0]
            updated=env.rate([(model[a],),(model[b],)],ranks=ranks)
            model[a],model[b]=updated[0][0],updated[1][0];model_counts.update((a,b))
    for item in human_items:
        if int(item.attrib['src-id'])-1 not in complete:continue
        names=[];ranks=[]
        for translation in item:
            for name in translation.attrib['system'].split():
                if name in human:names.append(name);ranks.append(int(translation.attrib['rank']))
        if len(names)<2:continue
        for name,team in zip(names,env.rate([(human[name],) for name in names],ranks=ranks)):
            human[name]=team[0];human_counts[name]+=1
    correlation=float(spearmanr([model[n].mu for n in systems],[human[n].mu for n in systems]).statistic) if complete else None
    if correlation is not None and not math.isfinite(correlation):correlation=None
    coverage=population['coverage']
    passed=bool(selection_audit and population['populationAlignmentVerified'] and ratings.get('status')=='completed' and correlation is not None and correlation>=.85
        and coverage>=.9 and len(complete)>=100 and all(human_counts[n] for n in systems))
    require_unchanged(code)
    return {'protocol':PROTOCOL,'status':'passed' if passed else 'unverified','scope':__doc__,
        'spearman':correlation,'completeSources':len(complete),'totalSources':len(sources),'coverage':coverage,
        'missingComparisons':len(expected.keys()-outcomes.keys()),'abstainedComparisons':sum(v=='abstain' for v in outcomes.values()),
        'systems':{n:{'modelMu':model[n].mu,'humanMu':human[n].mu,'modelComparisons':model_counts[n],'humanComparisons':human_counts[n]} for n in systems},
        'matrixSHA256':digest(pairs),'ratingsSHA256':digest(ratings),'humanJudgmentsSHA256':hashlib.sha256(human_data).hexdigest(),
        'selectionVerified':selection_audit is not None,'selectionAudit':selection_audit,
        'humanPopulation':population,
        'implementationSHA256':digest(code),'judge':ratings['judge'],'trueskillVersion':trueskill.__version__,'scipyVersion':scipy.__version__,
        'limitation':'Comparative ranking supplements sentence agreement; it does not establish absolute edit acceptance or complete-sentence correctness.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('prepare')
    e=sub.add_parser('evaluate');e.add_argument('--pairs',required=True);e.add_argument('--ratings',required=True)
    for command in (p,e):
        command.add_argument('--seeda',type=Path,required=True);command.add_argument('--output',required=True)
        command.add_argument('--matrix',required=True);command.add_argument('--document-map',required=True)
        command.add_argument('--display-map',required=True);command.add_argument('--cohort',required=True)
    args=parser.parse_args()
    if Path(args.output).exists():raise ValueError('Preserve existing ranking results; use a new output path.')
    verify_source(args.seeda)
    if args.action=='evaluate':
        selection={'matrix':records(args.matrix),'rawMap':read(args.document_map),
            'displayMap':read(args.display_map),'cohort':records(args.cohort)}
        write(args.output,evaluate(records(args.pairs),read(args.ratings),args.seeda,selection));return
    target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():raise ValueError('Preserve earlier ranking protocols.')
    outputs={path.stem:path.read_text('utf8').splitlines() for path in sorted((args.seeda/'outputs/all').glob('*.txt'))}
    cohort=records(args.cohort);matrix=records(args.matrix);raw=read(args.document_map);shown=read(args.display_map)
    pairs=prepare(matrix,raw,shown,outputs,cohort);sources,systems=shape(pairs)
    if len(sources)!=100:raise ValueError('Preserve the original frozen 100-source ranking population.')
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in pairs),'utf8')
    write(str(target)+'.manifest.json',{'protocol':PROTOCOL,'pairsSHA256':digest(pairs),'cases':len(pairs),'sources':len(sources),
        'systems':systems,'parentMatrixSHA256':digest(matrix),'cohortSHA256':digest(cohort),
        'documentMapSHA256':digest(raw),'displayMapSHA256':digest(shown),'seedaRevision':SEEDA_REVISION,
        'scope':__doc__,'modelInferencePerformed':False,'calibrationDocumentOverlap':0})
    print({'comparisons':len(pairs),'sources':len(sources),'systems':len(systems)})


if __name__=='__main__':main()
