"""Development smoke benchmark. These authored fixtures do not establish Grammarly parity."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alder.proofreading.contracts import configuration, model_correction
from alder.proofreading.engines import Resources, RuleEngine, ModelEngine
from alder import language


def apply(text, edits):
    encoded = text.encode("utf-16-le")
    for edit in sorted(edits, key=lambda item: item['start'], reverse=True):
        encoded = encoded[:edit['start'] * 2] + edit['replacement'].encode('utf-16-le') + encoded[edit['end'] * 2:]
    return encoded.decode('utf-16-le')


def benchmark(root, corpus, advanced):
    raw = corpus.read_bytes()
    examples = json.loads(raw)
    resources = Resources(root)
    rules, model = RuleEngine(resources), ModelEngine(resources)
    records = []
    try:
        for fixture in examples:
            config = configuration({}, {'dialect': fixture['dialect']})
            text = fixture['text']
            for engine in ['legacy', 'rules'] + (['model'] if advanced else []):
                started = time.monotonic()
                try:
                    if engine == 'legacy':
                        findings = language.analyze(text, {'language': fixture['dialect']})['annotations']
                        candidates = [apply(text, [{'start': item['start'], 'end': item['end'], 'replacement': item['suggestion']}])
                                      for item in findings if isinstance(item.get('suggestion'), str)]
                    elif engine == 'rules':
                        findings = rules.check(text, config)
                        candidates = [apply(text, alternative['edits']) for item in findings for alternative in item['alternatives'][:3]]
                    else:
                        item = model_correction(text, model.check(text, config, lambda: False), [])
                        findings = [item] if item else []
                        candidates = [apply(text, item['alternatives'][0]['edits'])] if item else []
                    clean = fixture['correct'] == [text]
                    records.append({'id': fixture['id'], 'engine': engine, 'dialect': fixture['dialect'],
                                    'seconds': round(time.monotonic() - started, 3), 'clean': clean,
                                    'findings': len(findings), 'falseAlarmOnClean': clean and bool(findings),
                                    'acceptedCandidate': bool(set(candidates) & set(fixture['correct'])) if not clean else not findings,
                                    'status': 'passed'})
                except Exception as error:
                    records.append({'id': fixture['id'], 'engine': engine, 'status': 'failed', 'error': str(error)})
            print(f"Checked {fixture['id']}", file=sys.stderr, flush=True)
    finally:
        rules.close(); model.close()
    implementation = Path(__file__).resolve().parents[1] / 'backend/alder/proofreading'
    return {'purpose': 'Small authored development smoke set; not an editorial evaluation or parity claim.',
            'statusDefinition': 'A passed record means the engine completed, not that its corrections passed quality review.',
            'implementationSHA256': {name: hashlib.sha256((implementation / name).read_bytes()).hexdigest()
                                     for name in ('worker.py', 'contracts.py', 'engines.py')},
            'platform': platform.platform(), 'python': platform.python_version(),
            'modelRevision': resources.revision, 'modelSHA256': resources.model_hash,
            'corpusSHA256': hashlib.sha256(raw).hexdigest(), 'examples': len(examples), 'records': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, default=Path(__file__).resolve().parents[1] / 'backend/tests/fixtures/proofreading.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--advanced', action='store_true')
    args = parser.parse_args()
    report = benchmark(args.resources, args.corpus, args.advanced)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', 'utf-8')
    print(json.dumps({'examples': report['examples'], 'output': str(args.output)}))
    if any(record['status'] != 'passed' for record in report['records']):
        sys.exit(1)
