"""Attach original neighbouring essay sentences to published pair comparisons.

No labels, partitions or candidates change. Context contains original source
sentences only, never corrections or annotation decisions. This is an explicit
new evaluation input, not permission to reuse source-only judge responses.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import subprocess
from common import digest, output_path, read, records, write
from conll_documents import compact, source_clusters

SEEDA_REVISION = 'f1b7d88f7b1c0b5701696198800cc42266d02da5'
POLICY = 'original-essay-neighbours-one-each-side-v1'


def contextualize(rows, raw_map, display_map, outputs):
    raw = raw_map['sentences']
    display = display_map['sentences']
    if not raw or len(raw) != len(display):
        raise ValueError('Original and displayed document inventories differ.')
    if display_map.get('displayTransformation', {}).get('parentDocumentMapSHA256') != digest(raw_map):
        raise ValueError('Displayed document map has a different parent.')
    lookup = defaultdict(list)
    closed, last = set(), None
    for index, (original, shown) in enumerate(zip(raw, display)):
        if (original['sourceIndex'] != index or shown['sourceIndex'] != index
                or original['documentGroup'] != shown['documentGroup']
                or compact(original['source']) != compact(shown['source'])
                or original['sourceSHA256'] != digest(original['source'])
                or shown['sourceSHA256'] != digest(shown['source'])):
            raise ValueError('Document map alignment or lexical verification failed.')
        group = original['documentGroup']
        if group != last:
            if group in closed:
                raise ValueError('Physical essay sentences are not contiguous.')
            if last is not None:
                closed.add(last)
            last = group
        lookup[compact(original['source'])].append(index)
    if outputs.get('INPUT') != [row['source'] for row in raw]:
        raise ValueError('Published INPUT is not the official original sentence inventory.')
    if any(len(values) != len(raw) for values in outputs.values()):
        raise ValueError('Published system output alignment differs.')
    result = []
    seen_ids = set()
    folds = defaultdict(set)
    clusters = source_clusters(display_map)
    for pair in rows:
        if pair['id'] in seen_ids:
            raise ValueError('Duplicate comparison identity.')
        seen_ids.add(pair['id'])
        if 'contextProvenance' in pair or pair.get('context', pair['source']) != pair['source']:
            raise ValueError('Preserve existing contextual presentations; do not overwrite them.')
        systems = pair.get('systems')
        if (not isinstance(systems, list) or len(systems) != 2
                or any(system not in outputs for system in systems)):
            raise ValueError('A published pair requires its two original system identities.')
        matches = [index for index in lookup[compact(pair['source'])]
                   if digest([index, *systems])[:24] == pair['id']]
        if len(matches) != 1:
            raise ValueError('Comparison identity does not identify exactly one original source.')
        index = matches[0]
        if pair['source'] != display[index]['source']:
            raise ValueError('Pair is not the verified displayed source.')
        if pair['group'] != digest(pair['source']):
            raise ValueError('Pair source group is not bound to its displayed text.')
        if any(compact(pair[field]) != compact(outputs[system][index])
               for field, system in zip(('a', 'b'), systems)):
            raise ValueError('Pair candidate differs from published system output.')
        group = raw[index]['documentGroup']
        # A duplicate-source union may name a different physical essay in the
        # existing cohort. The pair identity, not that union, selects context.
        indices = [i for i in range(max(0, index-1), min(len(raw), index+2))
                   if raw[i]['documentGroup'] == group]
        context = '\n'.join(display[i]['source'] for i in indices)
        result.append({**pair, 'context': context, 'contextProvenance': {
            'policy': POLICY, 'sourceIndex': index, 'sourceIndices': indices,
            'physicalDocumentGroup': group, 'documentMapSHA256': digest(display_map),
            'parentPairSHA256': digest(pair), 'targetLine': indices.index(index),
        }})
        folds[clusters[digest(pair['source'])]].add(pair['split'])
    if any(len(values) > 1 for values in folds.values()):
        raise ValueError('A duplicate-linked essay cluster crosses evaluation partitions.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', required=True)
    parser.add_argument('--document-map', required=True)
    parser.add_argument('--display-map', required=True)
    parser.add_argument('--seeda', type=Path, required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    revision = subprocess.check_output(['git', '-C', str(args.seeda), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(args.seeda), 'status', '--porcelain'], text=True)
    if revision != SEEDA_REVISION or dirty.strip():
        raise ValueError('Use the pinned, unchanged published SEEDA checkout.')
    paths = sorted((args.seeda/'outputs/all').glob('*.txt'))
    outputs = {path.stem: path.read_text('utf-8').splitlines() for path in paths}
    original = records(args.pairs)
    rows = contextualize(original, read(args.document_map), read(args.display_map), outputs)
    target = output_path(args.output)
    manifest = Path(str(target)+'.manifest.json')
    if target.exists() or manifest.exists():
        raise ValueError('Preserve prior presentations; use a new output path.')
    target.write_text(''.join(json.dumps(row, ensure_ascii=False)+'\n' for row in rows), 'utf-8')
    summary = {'scope': __doc__, 'policy': POLICY, 'cases': len(rows),
        'folds': dict(Counter(row['split'] for row in rows)),
        'sourceOnlyCases': sum(row['context'] == row['source'] for row in rows),
        'parentPairsSHA256': digest(original), 'pairsSHA256': digest(rows),
        'documentMapSHA256': digest(read(args.document_map)),
        'displayMapSHA256': digest(read(args.display_map)), 'seedaRevision': revision,
        'outputFilesSHA256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
        'labelsCandidatesPartitionsPreserved': all(
            {key: row[key] for key in pair if key != 'context'} ==
            {key: value for key, value in pair.items() if key != 'context'}
            for pair, row in zip(original, rows)),
        'implementationFilesSHA256': {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in ('contextualize_pairs.py', 'conll_documents.py', 'common.py')},
        'heldOutInference': False,
    }
    write(manifest, summary)
    print(json.dumps({key: summary[key] for key in ('cases', 'folds', 'sourceOnlyCases', 'pairsSHA256')}))


if __name__ == '__main__':
    main()
