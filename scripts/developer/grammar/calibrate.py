"""Measure a pinned judge against human pairs, with source-group uncertainty."""
import argparse
from collections import defaultdict
from pathlib import Path
from common import read, records, digest, write, execution_stamp, require_unchanged
from compare import interval
from judge import adjudicate


def calibrate(pairs, ratings, confidence=.95, document_map=None, partition_pairs=None, split='validation'):
    code_stamp={}
    for name in ('calibrate.py','compare.py','common.py','conll_documents.py','judge.py'):
        code_stamp.update(execution_stamp(Path(__file__).with_name(name)))
    if not .9<=confidence<1:raise ValueError('Unsupported calibration confidence level.')
    origins={p.get('datasetOrigin') for p in pairs}
    for pair in pairs:origins.update(pair.get('sourceDatasetOrigins',[]))
    training_overlap=bool(origins&set(ratings['judge'].get('trainingDatasetOrigins',[])))
    gold = {p['id']: p for p in pairs if p['split'] == split}
    if len(gold) != len([p for p in pairs if p['split'] == split]):
        raise ValueError('Duplicate human pair ids.')
    seen, decisions, unstable = set(), 0, 0
    ordered_pairs, order_changes = 0, 0
    outcomes = {p['id']: 0 for p in gold.values() if p['humanWinner'] != 'tie'}
    for row in ratings['records']:
        if row['id'] not in gold: continue
        pair = gold[row['id']]
        if row['id'] in seen or row['pairSHA256'] != digest(pair):
            raise ValueError('Repeated or mismatched judgment.')
        seen.add(row['id'])
        if pair['humanWinner'] == 'tie': continue
        decisions += 1
        if row['winner'] == 'abstain': unstable += 1
        orders=row.get('orderDecisions',[])
        reverse={'A':'B','B':'A','tie':'tie','abstain':'abstain'}
        if row['winner'] not in reverse:raise ValueError('Invalid calibration winner.')
        if len(orders)==2 and all(order in reverse for order in orders):
            if row['winner']!=adjudicate(*orders):raise ValueError('Calibration winner disagrees with its order decisions.')
            ordered_pairs+=1
            order_changes+=int(orders[0]!=reverse[orders[1]])
        outcomes[pair['id']] = int(row['winner'] == pair['humanWinner'])
    # Missing ratings are not successes or silently excluded from coverage.
    decisive = [p for p in gold.values() if p['humanWinner'] != 'tie']
    grouped = defaultdict(list);document_overlap=None
    if document_map:
        from conll_documents import source_clusters
        mapping=source_clusters(document_map)
        partition_population=[*pairs,*(partition_pairs or [])]
        if any(digest(pair['source']) not in mapping for pair in partition_population):raise ValueError('Human corpus source is absent from official document alignment.')
        folds=defaultdict(set)
        for pair in partition_population:folds[pair['split']].add(mapping[digest(pair['source'])])
        document_overlap=len(folds['validation']&folds['calibration']) if folds['validation'] and folds['calibration'] else None
    for pair in decisive:
        group=mapping[digest(pair['source'])] if document_map else pair['group']
        grouped[group].append(outcomes[pair['id']])
    agreement = sum(sum(v) for v in grouped.values()) / len(decisive) if decisive else 0
    bounds = interval(grouped,iterations=4000,alpha=1-confidence)
    abstentions = (unstable + len(gold.keys()-seen))/len(gold) if gold else 1
    order_instability=order_changes/ordered_pairs if ordered_pairs else None
    order_coverage=ordered_pairs/len(decisive) if decisive else 0
    limitations=[]
    if not document_map:limitations.append('No official document alignment; document-disjoint qualification is unverified')
    elif document_overlap is None:limitations.append('Calibration partition absent; document-disjoint qualification is unverified')
    elif document_overlap:limitations.append('Calibration and validation share documents; no document-disjoint qualification claim')
    require_unchanged(code_stamp)
    return {'status': 'unverified', 'analyzedSplit':split,
            'pairsSHA256':digest(pairs),'ratingsSHA256':digest(ratings),
            'analyzedPairsSHA256':digest([pair for pair in pairs if pair['split']==split]),
            'evaluationImplementationSHA256':digest(code_stamp),
            'pairwiseGatePassed': bool(split=='validation' and not training_overlap and document_map and document_overlap==0 and len(decisive) >= 100 and len(grouped) >= 20 and agreement >= .8 and bounds and bounds[0] > .75 and abstentions <= .1 and order_instability is not None and order_instability<=.05 and order_coverage>=.9),
            'agreement': agreement, 'interval': bounds, 'abstentions': abstentions,
            'orderInstability':order_instability,'orderCoverage':order_coverage,'orderChanges':order_changes,
            'confidence':confidence,
            'bootstrapUnit':'official document (duplicates unioned)' if document_map else 'declared source group',
            'bootstrapGroups':len(grouped),'calibrationValidationDocumentOverlap':document_overlap,
            'documentMapSHA256':digest(document_map) if document_map else None,
            'partitionAuditSHA256':digest(partition_pairs) if partition_pairs is not None else None,
            'qualificationLimitations':limitations,
            'decisiveHumanPairs': len(decisive), 'rated': decisions, 'missing': len(gold.keys()-seen),
            'trainingDatasetOverlap':training_overlap,
            'goldConstruction':sorted({p.get('preferenceConstruction','direct human pair ranks') for p in pairs}),
            'remainingGates': ['system ranking correlation', 'harmful mutation detection', 'order stability', 'independent second judge'],
            'judge': ratings['judge'], 'scope': 'Pairwise calibration; never sufficient alone for promotion'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', required=True)
    parser.add_argument('--ratings', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--confidence',type=float,default=.95)
    parser.add_argument('--document-map',help='Official source-to-document alignment; use document-cluster bounds')
    parser.add_argument('--partition-pairs',help='Include calibration sources when auditing document overlap')
    parser.add_argument('--split',choices=['calibration','validation'],default='validation')
    args = parser.parse_args()
    write(args.output, calibrate(records(args.pairs), read(args.ratings),args.confidence,
      read(args.document_map) if args.document_map else None,
      records(args.partition_pairs) if args.partition_pairs else None,args.split))


if __name__ == '__main__':
    main()
