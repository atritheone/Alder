"""Calibrate unanimous edit acceptance, never complete-sentence correctness.

This separate research component preserves the original full-sentence protocol.
Its 25-policy calibration grid and held-out requirements are fixed in the plan.
No model or fitted policy is installed into Alder.
"""
import argparse
from collections import defaultdict
import math
from pathlib import Path
import random
from common import digest, read, records, write, execution_stamp, require_unchanged
from conll_documents import source_clusters

PROTOCOL = 'alder-edit-validity-calibration-v1'
QUANTILES = (0, .1, .2, .3, .4)
AXES = ('grammaticality', 'faithfulness')


def stamp():
    result = {}
    for name in ('edit_acceptance.py', 'common.py', 'conll_documents.py'):
        result.update(execution_stamp(Path(__file__).with_name(name)))
    return result


def labelled(pairs, document_map):
    clusters = source_clusters(document_map)
    expected = {pair['id']: pair for pair in pairs}
    if not pairs or len(expected) != len(pairs):
        raise ValueError('Acceptance population must have distinct comparisons.')
    folds = defaultdict(set); examples = []
    for pair in pairs:
        if (pair['split'] not in ('calibration', 'validation') or pair['b'] != pair['source']
                or pair['a'] == pair['source'] or pair['group'] != digest(pair['source'])
                or type(pair.get('humanEditsAcceptable')) is not bool
                or type(pair.get('humanAnnotators')) is not int or pair['humanAnnotators'] < 2
                or 'humanFullyCorrect' in pair):
            raise ValueError('Expected edited, source-bound, independently rated edit-validity labels.')
        document = clusters.get(digest(pair['source']))
        if document is None or document != pair.get('documentGroup'):
            raise ValueError('Acceptance labels require their official source-essay clusters.')
        folds[document].add(pair['split']); examples.append((pair,document))
    if any(len(values) > 1 for values in folds.values()):
        raise ValueError('Acceptance calibration and validation share an essay cluster.')
    return examples


def population(pairs, ratings, document_map):
    labels = labelled(pairs,document_map)
    expected = {pair['id']:pair for pair in pairs}
    scored = {}
    for row in ratings['records']:
        key = row['id']
        if key not in expected or key in scored or row['pairSHA256'] != digest(expected[key]):
            raise ValueError('Acceptance scores do not match the frozen population.')
        dimensions = row.get('dimensions')
        if not isinstance(dimensions, list) or len(dimensions) != 2:
            raise ValueError('Expected separately scored candidate/source dimensions.')
        value = dimensions[0]
        if value is not None and (not isinstance(value, dict) or any(
                type(value.get(axis)) not in (float, int) or not math.isfinite(value[axis]) for axis in AXES)):
            raise ValueError('Acceptance axes must be finite real scores.')
        scored[key] = None if value is None else {axis: value[axis] for axis in AXES}
    return [(pair,scored.get(pair['id']),document) for pair,document in labels]


def selected(examples, cutoffs):
    return [(pair, document) for pair, value, document in examples
        if value is not None and all(value[axis] >= cutoffs[axis] for axis in AXES)]


def summarize(examples, cutoffs):
    approved = selected(examples, cutoffs)
    correct = sum(pair['humanEditsAcceptable'] for pair, _ in approved)
    return {'cases': len(examples), 'scorable': sum(value is not None for _, value, _ in examples),
        'approved': len(approved), 'unanimouslyAccepted': correct,
        'nonUnanimousApprovals': len(approved)-correct,
        'agreement': correct/len(approved) if approved else None,
        'approvedSourceGroups': len({pair['group'] for pair, _ in approved}),
        'approvedDocumentGroups': len({document for _, document in approved})}


def fit(pairs, ratings, document_map):
    code = stamp()
    examples = [item for item in population(pairs, ratings, document_map) if item[0]['split'] == 'calibration']
    values = {axis: sorted(value[axis] for _, value, _ in examples if value is not None) for axis in AXES}
    grid = []; best = None; best_key = None
    if all(values.values()):
        cutoffs = {axis: [values[axis][int((len(values[axis])-1)*q)] for q in QUANTILES] for axis in AXES}
        for grammar in cutoffs['grammaticality']:
            for faithfulness in cutoffs['faithfulness']:
                policy = {'grammaticality': grammar, 'faithfulness': faithfulness}
                result = summarize(examples, policy)
                coverage = (result['approved'] >= 60 and result['approvedSourceGroups'] >= 25
                    and result['approvedDocumentGroups'] >= 10)
                eligible = bool(coverage and result['agreement'] >= .95)
                grid.append({'cutoffs': policy, 'metrics': result, 'eligible': eligible})
                key = (result['approved'], result['unanimouslyAccepted'], grammar, faithfulness)
                if eligible and (best_key is None or key > best_key):
                    best, best_key = {'cutoffs': policy, 'metrics': result}, key
    require_unchanged(code)
    return {'protocol': PROTOCOL, 'status': 'frozen-calibration-policy' if best else 'failed-calibration',
        'labelScope': __doc__, 'fitSplit': 'calibration', 'policy': best,
        'calibrationGrid': grid, 'quantiles': list(QUANTILES),
        'pairsSHA256': digest(pairs), 'ratingsSHA256': digest(ratings),
        'documentMapSHA256': digest(document_map),
        'scorerIdentitySHA256': digest({'judge': ratings['judge'], 'implementation': ratings.get('implementationSHA256')}),
        'implementationSHA256': digest(code), 'validationAnalyzed': False,
        'limitation': 'Edit acceptance is distinct from completeness, fluency, critical meaning and general product qualification.'}


def evaluate(pairs, ratings, document_map, policy):
    code = stamp()
    if (policy.get('protocol') != PROTOCOL or policy.get('status') != 'frozen-calibration-policy'
            or not policy.get('policy') or policy.get('implementationSHA256') != digest(code)
            or policy.get('pairsSHA256') != digest(pairs) or policy.get('ratingsSHA256') != digest(ratings)
            or policy.get('documentMapSHA256') != digest(document_map)):
        raise ValueError('Use an unchanged, frozen edit-validity calibration policy and its exact inputs.')
    if digest(fit(pairs, ratings, document_map)) != digest(policy):
        raise ValueError('Frozen policy differs from the declared calibration-only fit.')
    examples = [item for item in population(pairs, ratings, document_map) if item[0]['split'] == 'validation']
    cutoffs = policy['policy']['cutoffs']; metrics = summarize(examples, cutoffs)
    documents = defaultdict(lambda: [0, 0])
    for _, _, document in examples: documents[document]
    for pair, document in selected(examples, cutoffs):
        documents[document][0] += int(pair['humanEditsAcceptable']); documents[document][1] += 1
    samples = []; rng = random.Random(917)
    if len(documents) > 1:
        for _ in range(4000):
            sample = rng.choices(list(documents.values()), k=len(documents))
            total = sum(value[1] for value in sample)
            samples.append(sum(value[0] for value in sample)/total if total else 0.)
        samples.sort()
    passed = bool(metrics['approved'] >= 100 and metrics['approvedSourceGroups'] >= 35
        and metrics['approvedDocumentGroups'] >= 20 and metrics['agreement'] >= .95)
    require_unchanged(code)
    return {'protocol': PROTOCOL, 'status': 'passed' if passed else 'failed', 'analyzedSplit': 'validation',
        'labelScope': 'Unanimous acceptance of every proposed edit; not complete-sentence correctness.',
        'policySHA256': digest(policy), 'metrics': metrics,
        'agreement95DocumentBootstrap': [samples[100], samples[3900]] if samples else None,
        'bootstrapIterations': 4000, 'bootstrapSeed': 917,
        'pairsSHA256': digest(pairs), 'ratingsSHA256': digest(ratings),
        'documentMapSHA256': digest(document_map), 'implementationSHA256': digest(code),
        'promotion': 'none; this component cannot qualify a full evaluator or product',
        'limitations': ['Learner-essay domain; source-only metric, not context-aware semantic approval.',
            'A nonpositive label means lack of unanimity, not proof that an edit is wrong.',
            'Public pretraining overlap is unknown. No production redistribution or training grant asserted.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['fit', 'evaluate'])
    parser.add_argument('--pairs', required=True); parser.add_argument('--ratings', required=True)
    parser.add_argument('--document-map', required=True); parser.add_argument('--policy')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if Path(args.output).exists(): raise ValueError('Preserve previous policies/results; use a new output path.')
    inputs = records(args.pairs), read(args.ratings), read(args.document_map)
    if args.action == 'fit': result = fit(*inputs)
    else:
        if not args.policy: raise ValueError('Validation requires a saved calibration policy.')
        result = evaluate(*inputs, read(args.policy))
    write(args.output, result)
    print({'status': result['status'], 'validationAnalyzed': result.get('validationAnalyzed', True)})


if __name__ == '__main__': main()
