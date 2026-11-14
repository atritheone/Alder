"""Synthetic manifest/event cost only; no claim about synthesis or audio quality."""
import argparse
from collections import deque
import copy
import json
from pathlib import Path
import statistics
import sys
import tempfile
import threading
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from alder.speech_pipeline import SpeechPipeline

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--selective',action='store_true');args=parser.parse_args()
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    report={'scope':'Synthetic durable manifests and delta publication; no audio eligibility, synthesis or recognition workload.','sizes':[]}
    with tempfile.TemporaryDirectory(prefix='alder-speech-state-') as folder:
        service=SpeechPipeline.__new__(SpeechPipeline)
        service.root=Path(folder);service._lock=threading.RLock();service._event_condition=threading.Condition()
        service._signatures={};service._events={};service._orders={};service._jobs={};service._demand={}
        service._eligible=lambda *args:False
        for size in (10,100,1000,10000):
            job={'id':f'fixture-{size}','projectId':'synthetic','status':'queued','createdAt':'2026-11-14','sourceRevision':1,
                 'chunks':[{'id':f'chunk-{i}','text':'A synthetic passage with Unicode café 😀. '*5,'status':'queued','seed':i,'sourceStart':i*100,'sourceEnd':i*100+100,'wordTimings':[{'text':'synthetic','start':0,'end':.5}]} for i in range(size)]}
            (service.root/'jobs'/job['id']).mkdir(parents=True);service._jobs[job['id']]=job
            timings=[];service._persist(job)
            for sample in range(10):
                job['chunks'][sample%size]['status']=str(sample)
                started=time.perf_counter();service._persist(job, {job['chunks'][sample%size]['id']} if args.selective else None);timings.append((time.perf_counter()-started)*1000)
                assert len(service._events[job['id']][-1]['chunks'])==1
            report['sizes'].append({'chunks':size,'persistMs':timings,'medianMs':statistics.median(timings),'manifestBytes':(service.root/'jobs'/job['id']/'manifest.json').stat().st_size})
    (output/'speech-state.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
if __name__=='__main__':main()
