"""Shared, dependency-free contracts for developer-only grammar evaluation."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION = 1


def reject_nonfinite(value):
    raise ValueError('Non-finite numbers are not valid evaluation evidence: '+value)


def execution_stamp(script):
    paths=[Path(script).resolve(),Path(__file__).resolve()]
    return {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def require_unchanged(stamp):
    if any(hashlib.sha256(Path(path).read_bytes()).hexdigest()!=value for path,value in stamp.items()):
        raise ValueError('Evaluation code changed during inference; retain raw diagnostics but do not qualify this run.')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'),allow_nan=False).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text('utf-8'),parse_constant=reject_nonfinite)


def output_path(path):
    target = Path(path).resolve()
    if target.is_relative_to(ROOT):
        raise ValueError('Generated evaluation state must be outside the checkout.')
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def write(path, value):
    target = output_path(path)
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2,allow_nan=False) + '\n', 'utf-8')
    temporary.replace(target)


def records(path):
    return [json.loads(line,parse_constant=reject_nonfinite) for line in Path(path).read_text('utf-8').splitlines() if line.strip()]


def corpus(path):
    data = read(path)
    if data.get('schemaVersion') != VERSION or data.get('rights', {}).get('evaluationAllowed') is not True:
        raise ValueError('Missing corpus schema or evaluated data rights.')
    cases = data['cases']
    if not isinstance(cases,list) or not cases:
        raise ValueError('Corpus must contain cases.')
    ids, groups, sources = set(), {}, {}
    for case in cases:
        if any(key in case for key in ('mustContain','mustPreserve','expectUnchanged')):
            raise ValueError('Unsupported expectation fields; use required/protected and the clean track explicitly.')
        for field in ('required','forbidden','protected','acceptedWords'):
            if field in case and (not isinstance(case[field],list) or any(not isinstance(value,str) or not value.strip() for value in case[field])):
                raise ValueError('Evaluation check/vocabulary fields require lists of nonempty strings.')
        if case['id'] in ids or not case['source'].strip():
            raise ValueError('Duplicate id or empty source.')
        ids.add(case['id'])
        if case['split'] not in ('development', 'validation', 'test', 'calibration'):
            raise ValueError('Invalid partition.')
        for mapping, key in ((groups, case['group']), (sources, case['source'].casefold())):
            if key in mapping and mapping[key] != case['split']:
                raise ValueError('Related examples leak across partitions.')
            mapping[key] = case['split']
        if case['dialect'] not in ('en-AU', 'en-GB', 'en-US'):
            raise ValueError('Unsupported evaluation dialect.')
        if case['profile'] not in ('standard', 'creative'):
            raise ValueError('Invalid profile.')
        if case['track'] not in ('correctness', 'clarity', 'clean', 'semantic', 'document'):
            raise ValueError('Invalid evaluation track.')
        if 'caseSensitiveChecks' in case and type(case['caseSensitiveChecks']) is not bool:
            raise ValueError('Literal check case sensitivity must be boolean.')
    return data


def delivered(record):
    """Suppressed and failed proposals do not count as corrected sentences."""
    return record['proposal'] if record['status'] == 'completed' and record['displayed'] else record['source']


def checks(case, proposal):
    failures = []
    def occurs(text):
        return re.search(r'(?<!\w)'+re.escape(text.strip())+r'(?!\w)',proposal,
                         flags=0 if case.get('caseSensitiveChecks',True) else re.I) is not None
    for text in case.get('required', []):
        if not occurs(text):
            failures.append({'kind': 'missing', 'text': text})
    for text in case.get('forbidden', []):
        if occurs(text):
            failures.append({'kind': 'residual', 'text': text})
    for text in case.get('protected', []):
        if case['source'].count(text) != proposal.count(text):
            failures.append({'kind': 'protected', 'text': text})
    if case['track'] == 'clean' and proposal != case['source']:
        failures.append({'kind': 'unnecessary-change'})
    return failures
