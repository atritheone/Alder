"""Exercise current service validation against recorded local model responses.

This is an integration replay, never fresh neural inference or qualification of a
new prompt. Unrecorded model requests fail rather than fabricating a response.
"""
import argparse
import json
from pathlib import Path
import sys
import time
from common import ROOT,corpus,records,read,write,digest,output_path,execution_stamp,require_unchanged
import generate


def select(rows,expected,split,ids=None):
    population=[row for row in rows if expected[row['id']]['split']==split]
    if ids is None:return population
    if len(ids)!=len(set(ids)) or set(ids)-{row['id'] for row in population}:
        raise ValueError('Replay selection contains repeated, unknown or out-of-split cases.')
    return [row for row in population if row['id'] in set(ids)]


def main():
    stamp=execution_stamp(__file__);implementation=generate.source_snapshot()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',required=True);parser.add_argument('--baseline',required=True)
    parser.add_argument('--resources',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--split',choices=['development','validation','test'],default='development')
    parser.add_argument('--case-ids',nargs='+',help='Explicit targeted replay selection; recorded in the evidence identity')
    args=parser.parse_args();data=corpus(args.corpus);baseline=records(args.baseline)
    origin=read(Path(args.baseline).with_suffix('.manifest.json'))
    if origin['settings']['corpus']!=digest(data):raise ValueError('Replay corpus differs from recorded inference.')
    expected={c['id']:c for c in data['cases']}
    if len({r['id'] for r in baseline})!=len(baseline):raise ValueError('Repeated recorded inference ids.')
    if any(row['id'] not in expected or row['source']!=expected[row['id']]['source'] for row in baseline):
        raise ValueError('Recorded source differs from corpus.')
    target=output_path(args.output)
    if target.exists():raise ValueError('Use a new replay output; do not overwrite evidence.')
    selected=select(baseline,expected,args.split,args.case_ids)
    service=generate.ProofreadingService(Path(args.resources),target.parent/'replay-service-data')
    fingerprint=digest([origin['fingerprint'],implementation,stamp,sorted(args.case_ids) if args.case_ids else None])
    try:
        for row in selected:
            case=expected[row['id']];trace=row['modelTrace'];used=[]
            if not trace or any('error' in item for item in trace):raise ValueError('Inference failure cannot be replayed as a successful candidate.')
            def recorded(text,config,cancelled):
                if cancelled():raise InterruptedError()
                phase='spelling-repair' if config.get('spellingRepair') else 'generation'
                candidates=[(i,item) for i,item in enumerate(trace) if i not in used and item['source']==text and item['phase']==phase]
                if not candidates:raise RuntimeError('Replay requested an unrecorded model input; fresh inference is required.')
                index,item=candidates[0];used.append(index);return item['proposal']
            service.model.check=recorded
            context=case.get('context',case['source'])
            if context.count(case['source'])!=1:raise ValueError('Ambiguous replay target context.')
            offset=len(context[:context.index(case['source'])].encode('utf-16-le'))//2
            job=service.start({'text':context,'targetId':'replay','revision':True,
              'range':{'start':offset,'end':offset+len(case['source'].encode('utf-16-le'))//2},
              'languageRanges':[{**r,'start':r['start']+offset,'end':r['end']+offset} for r in case.get('languageRanges',[])],
              'configuration':{'dialect':case['dialect'],'revisionProfile':case['profile'],'acceptedWords':case.get('acceptedWords',[])}})
            deadline=time.monotonic()+60
            while job['status'] not in ('completed','partial','failed','cancelled'):
                if time.monotonic()>deadline:raise RuntimeError('Replay deadline exceeded.')
                time.sleep(.01);job=service.get(job['id'])
            proposal=case['source']
            for item in sorted(job['annotations'],key=lambda a:a['start'],reverse=True):
                encoded=proposal.encode('utf-16-le');start,end=item['start']-offset,item['end']-offset
                if not 0<=start<=end<=len(encoded)//2:raise ValueError('Replay escaped its target.')
                proposal=(encoded[:start*2]+item['replacementText'].encode('utf-16-le')+encoded[end*2:]).decode('utf-16-le')
            if generate.source_snapshot()!=implementation:raise ValueError('Replay implementation changed.')
            result={'id':row['id'],'group':case['group'],'source':case['source'],'proposal':proposal,
              'status':'completed' if job['status']=='completed' else 'failed','displayed':bool(job['annotations']),
              'serviceStatus':job['status'],'warnings':job['warnings'],'fingerprint':fingerprint,
              'evidenceKind':'recorded-model-integration-replay','recordedFingerprint':row['fingerprint'],
              'recordedCallsUsed':used,'recordedCallsAvailable':len(trace)}
            with target.open('a',encoding='utf-8') as stream:stream.write(json.dumps(result,ensure_ascii=False)+'\n')
        require_unchanged(stamp)
        write(target.with_suffix('.manifest.json'),{'status':'completed','fingerprint':fingerprint,
          'evidenceKind':'recorded-model-integration-replay','scope':__doc__,'cases':len(selected),
          'corpusSHA256':digest(data),'recordedInferenceSHA256':digest(baseline),
          'caseSelection':sorted(args.case_ids) if args.case_ids else None,
          'recordedManifestSHA256':digest(origin),'implementation':implementation})
        print(json.dumps({'cases':len(selected),'scope':'recorded-model integration replay, not fresh inference'}))
    finally:service.shutdown()


if __name__=='__main__':main()
