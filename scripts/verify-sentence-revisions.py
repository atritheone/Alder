"""Real local inference smoke check; this does not certify editorial quality."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import socket
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from alder.proofreading.contracts import configuration
from alder.proofreading.engines import Resources, ModelEngine
from alder.proofreading.revisions import revision, REVISION_PROMPT_VERSION


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(ROOT):parser.error('Write generated evidence outside the checkout.')
    engine=ModelEngine(Resources(args.resources))
    source='The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.'
    report={'scope':'Runtime smoke check, not installed desktop or editorial qualification',
            'platform':sys.platform,'architecture':platform.machine(),'promptVersion':REVISION_PROMPT_VERSION,
            'externalNetworkBlocked':sys.platform.startswith('linux') and {name for _,name in socket.if_nameindex()}=={'lo'},
            'modelRevision':engine.resources.revision,'modelSHA256':engine.resources.model_hash,'records':[]}
    try:
        for dialect in ('en-AU','en-GB','en-US'):
            config={**configuration({}, {'dialect':dialect}),'task':'revise','context':source}
            started=time.monotonic();proposal=engine.check(source,config,lambda:False)
            assert revision(source,proposal,[]) is not None,'No validated structural revision'
            report['records'].append({'dialect':dialect,'source':source,'proposal':proposal,'seconds':round(time.monotonic()-started,3)})
        clean='The train arrived before noon.'
        config={**configuration({}),'task':'revise','context':clean}
        assert engine.check(clean,config,lambda:False)==clean,'Clean reference sentence changed'
        field='(Dr. Smith, 2020)'
        cited='The report '+field+' it contains several errors which needs correcting.'
        config={**configuration({}, {'acceptedWords':[field]}),'task':'revise','context':cited}
        proposal=engine.check(cited,config,lambda:False)
        assert revision(cited,proposal,[field]) is not None,'Citation-preserving revision failed'
        report['citation']={'source':cited,'proposal':proposal}
        report['status']='passed'
    finally:engine.close()
    report['implementationSHA256']={name:hashlib.sha256((ROOT/'backend/alder/proofreading'/name).read_bytes()).hexdigest()
                                   for name in ('worker.py','revisions.py','engines.py')}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
