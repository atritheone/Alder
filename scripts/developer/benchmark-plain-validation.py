"""Paired plain/general validation on one native interpreter; synthetic input."""
import argparse
import copy
import json
from pathlib import Path
import platform
import statistics
import time
from alder.models import text_document, validate_document

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
text = ('A synthetic manuscript preserves its words and line boundaries.\n' * 17000)[:1024 * 1024]
source = text_document(text)
for index, node in enumerate(source['content']): node['attrs'] = {'blockId': f'block_{index}'}
values = {'general': [], 'plain': []}
results = {}
for iteration in range(6):
    for name in (('general','plain') if iteration % 2 == 0 else ('plain','general')):
        document = copy.deepcopy(source)
        start = time.perf_counter()
        results[name] = validate_document(document, _plain_fast=name == 'plain')
        elapsed = (time.perf_counter() - start) * 1000
        if iteration: values[name].append(elapsed)
assert results['general'] == results['plain'] == source
report = {'platform':platform.system(),'architecture':platform.machine(),'python':platform.python_version(),
          'status':'passed','timingsMs':values,'medianMs':{key:statistics.median(value) for key,value in values.items()}}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
