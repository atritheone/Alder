"""Import source-aligned human pair preferences from a pinned local SEEDA checkout."""
import argparse
from collections import Counter, defaultdict
import itertools
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from common import digest, output_path, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seeda', type=Path, required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = args.seeda.resolve()
    revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    sources = (root/'outputs/all/INPUT.txt').read_text('utf-8').splitlines()
    outputs = {p.stem: p.read_text('utf-8').splitlines() for p in (root/'outputs/all').glob('*.txt')}
    if any(len(rows) != len(sources) for rows in outputs.values()):
        raise ValueError('SEEDA system outputs are not aligned.')
    votes = defaultdict(dict)
    xml = root/'data/judgments_sent.xml'
    for item in ET.parse(xml).getroot().iter('ranking-item'):
        source = int(item.attrib['src-id'])-1
        if not 0 <= source < len(sources): raise ValueError('Unaligned human source id.')
        ranks = {system: int(trans.attrib['rank']) for trans in item for system in trans.attrib['system'].split()}
        for a, b in itertools.combinations(sorted(ranks), 2):
            winner = 'A' if ranks[a] < ranks[b] else 'B' if ranks[b] < ranks[a] else 'tie'
            key = (source, a, b)
            annotator = item.attrib['user']
            if annotator in votes[key] and votes[key][annotator] != winner:
                votes[key][annotator] = None  # Inconsistent repeated human ratings abstain.
            elif annotator not in votes[key]:
                votes[key][annotator] = winner
    rows = []
    for (source, a, b), annotators in sorted(votes.items()):
        counts = Counter(value for value in annotators.values() if value is not None)
        if not counts: continue
        winner, count = counts.most_common(1)[0]
        if count <= sum(counts.values())/2: continue
        text = sources[source]
        group = digest(text)
        rows.append({'id': digest([source,a,b])[:24], 'group': group,
                     'split': 'calibration' if int(group[:8],16)%5 < 3 else 'validation',
                     'source': text, 'a': outputs[a][source], 'b': outputs[b][source],
                     'humanWinner': winner, 'humanVotes': dict(counts), 'systems': [a,b]})
    target = output_path(args.output)
    target.write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in rows), 'utf-8')
    write(target.with_suffix('.manifest.json'), {'source': 'https://github.com/tmu-nlp/SEEDA',
          'revision': revision, 'pairs': len(rows), 'pairsSHA256': digest(rows),
          'scope': 'Published human sentence preferences for local research evaluation; no redistribution grant asserted',
          'filesSHA256': {str(p.relative_to(root)): __import__('hashlib').sha256(p.read_bytes()).hexdigest()
                          for p in [xml, *sorted((root/'outputs/all').glob('*.txt'))]}})
    print(json.dumps({'pairs': len(rows), 'revision': revision}))


if __name__ == '__main__':
    main()
