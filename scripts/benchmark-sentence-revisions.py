"""Record actual local sentence revisions for subsequent editorial assessment."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from alder.proofreading.contracts import configuration
from alder.proofreading.engines import Resources, ModelEngine
from alder.proofreading.revisions import revision, REVISION_PROMPT_VERSION


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--corpus',type=Path,default=ROOT/'backend/tests/fixtures/sentence-revisions.json')
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(ROOT):parser.error('Write generated evidence outside the checkout.')
    corpus=json.loads(args.corpus.read_text('utf-8'))
    engine=ModelEngine(Resources(args.resources))
    report={'purpose':corpus['purpose'],'humanReviewRequired':True,'promptVersion':REVISION_PROMPT_VERSION,
            'modelRevision':engine.resources.revision,'modelSHA256':engine.resources.model_hash,'records':[]}
    report['implementationSHA256']={name:hashlib.sha256((ROOT/'backend/alder/proofreading'/name).read_bytes()).hexdigest()
                                    for name in ('worker.py','revisions.py','engines.py')}
    try:
        for population in ('problematic','clean'):
            for index,source in enumerate(corpus[population]):
                config={**configuration({}, {'dialect':'en-US' if 'neighbors' in source else 'en-AU'}),
                        'task':'revise','context':source}
                started=time.monotonic()
                try:
                    proposal=engine.check(source,config,lambda:False)
                    item=revision(source,proposal,[])
                    record={'source':source,'proposal':proposal,'changed':proposal!=source,'displayed':item is not None,'status':'completed'}
                except Exception as error:record={'source':source,'status':'failed','error':str(error)}
                record.update(population=population,seconds=round(time.monotonic()-started,3))
                report['records'].append(record)
                args.output.parent.mkdir(parents=True,exist_ok=True)
                args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
                print(f'{population} {index+1}: {record["status"]}',flush=True)
    finally:engine.close()
    if any(r['status']=='failed' for r in report['records']):sys.exit(1)


if __name__=='__main__':main()
