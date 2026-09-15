"""Real-engine benchmark. Run with PYTHONPATH=backend; use a fresh --data path.

Backend availability is distinct from audible latency; this runner never claims
that generated audio was heard. Optional sustained workload uses fresh seeds.
"""
import argparse
import json
import os
import platform
import subprocess
import time
from pathlib import Path
from alder.speech_pipeline import SpeechPipeline


def summary(values):
    values = sorted(v for v in values if v is not None)
    def percentile(q): return values[min(len(values)-1, round((len(values)-1)*q))] if values else None
    return dict(n=len(values), p50=percentile(.5), p95=percentile(.95), p99=percentile(.99))


def resources(s):
    result = {}
    try:
        import psutil
        processes = [psutil.Process(os.getpid())]
        processes += processes[0].children(recursive=True)
        result['rssBytes'] = sum(p.memory_info().rss for p in processes if p.is_running())
    except (ImportError, OSError):
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            class Counters(ctypes.Structure):
                _fields_ = [('cb',wintypes.DWORD),('faults',wintypes.DWORD)] + [(n,ctypes.c_size_t) for n in ['peakWorkingSet','workingSet','peakPaged','paged','peakNonpaged','nonpaged','pagefile','peakPagefile']]
            kernel=ctypes.WinDLL('kernel32',use_last_error=True)
            api=ctypes.WinDLL('psapi',use_last_error=True)
            kernel.OpenProcess.restype=wintypes.HANDLE
            kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
            kernel.CloseHandle.argtypes=[wintypes.HANDLE]
            api.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
            total=0
            class Entry(ctypes.Structure):
                _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('name',wintypes.WCHAR*260)]
            kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
            kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD]
            for name in ['Process32FirstW','Process32NextW']:
                getattr(kernel,name).argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
            snapshot=kernel.CreateToolhelp32Snapshot(2,0)
            entries=[]
            try:
                entry=Entry();entry.size=ctypes.sizeof(entry)
                ok=kernel.Process32FirstW(snapshot,ctypes.byref(entry))
                while ok:
                    entries.append((entry.pid,entry.parent));ok=kernel.Process32NextW(snapshot,ctypes.byref(entry))
            finally: kernel.CloseHandle(snapshot)
            pids={os.getpid()}
            for _ in range(4): pids.update(pid for pid,parent in entries if parent in pids)
            for pid in pids:
                handle=kernel.OpenProcess(0x410,False,pid)
                if not handle: continue
                try:
                    c=Counters();c.cb=ctypes.sizeof(c)
                    if api.GetProcessMemoryInfo(handle,ctypes.byref(c),c.cb): total+=c.workingSet
                finally: kernel.CloseHandle(handle)
            result['rssBytes']=total
    try:
        flags = {'creationflags':subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        output = subprocess.check_output(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits'],text=True,timeout=3,**flags)
        result['systemVramMiB'] = int(output.splitlines()[0])
    except (OSError,ValueError,subprocess.SubprocessError): pass
    result['cacheBytes'] = sum(p.stat().st_size for p in (s.root/'cache').glob('*') if p.is_file())
    return result


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',required=True)
    p.add_argument('--device',choices=['cuda','cpu'],default='cuda')
    p.add_argument('--samples',type=int,default=10)
    p.add_argument('--sustained-seconds',type=float,default=0)
    p.add_argument('--skip-corpus',action='store_true',help='Isolate queue throughput after the correctness corpus has been tested.')
    args=p.parse_args()
    os.environ['ALDER_SPEECH_DEVICE']=args.device
    fixtures=json.loads(Path('scripts/speech-fixtures.json').read_text('utf-8-sig'))
    data=Path(args.data); data.mkdir(parents=True,exist_ok=True)
    output=data/'results.json'
    report={'fixtureVersion':fixtures['version'],'platform':platform.platform(),'device':args.device,'measurements':[],'resources':[],'scope':'Backend verified availability; not an acoustic playback measurement.'}
    s=SpeechPipeline(data,Path.cwd())
    def save(): output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    def measure(label,text,seed):
        started=time.monotonic(); first=None
        j=s.submit({'id':'benchmark','revision':0,'pronunciation':[]},{'scope':'selection','text':text,'voiceId':'default','seed':seed})
        while time.monotonic()-started < 240:
            j=s.get_job(j['id'])
            if first is None and j['chunks'][0].get('playbackEligible'): first=time.monotonic()-started
            if j['status'] in {'ready','needs_review','failed','cancelled'}: break
            time.sleep(.01)
        else:
            s.cancel(j['id'])
            raise RuntimeError('Benchmark timed out')
        item=dict(label=label,jobId=j['id'],status=j['status'],firstVerifiedSeconds=first,totalSeconds=time.monotonic()-started,audioSeconds=sum(c.get('seconds',0) for c in j['chunks']),acceptedSections=sum(c['playbackEligible'] for c in j['chunks']),sections=len(j['chunks']),cachedSections=sum(bool(c.get('cached')) for c in j['chunks']),cachedChecks=sum(bool(c.get('checkCached')) for c in j['chunks']),sourceCoverage=False)
        # Non-whitespace coverage is compared against the actual source, not a reconstruction of itself.
        item['sourceCoverage']=''.join(''.join(c['text'].split()) for c in j['chunks'])==''.join(text.split())
        report['measurements'].append(item)
        report['resources'].append(resources(s))
        save()
        print(label,j['status'],round(item['totalSeconds'],3),flush=True)
        return item
    try:
        measure('cold',fixtures['short'],100)
        report['runtime']={**s.runtime,'health':s._worker_health}
        for i in range(args.samples): measure('warm',fixtures['short'],101+i)
        for i in range(args.samples): measure('cache',fixtures['short'],101+i)
        if not args.skip_corpus:
            for i,text in enumerate(fixtures['corpus']): measure('corpus',text,1000+i)
        # Sustained synthesis/checking with unique seeds prevents a short cached
        # loop from masquerading as a long generative workload.
        recovery=Path('chatterbox/outputs/recovery-passage.txt')
        if not args.skip_corpus and recovery.exists(): measure('recovery-passage',recovery.read_text('utf-8'),1700)
        duration=0; index=0
        while duration < args.sustained_seconds and not (data/'STOP').exists():
            item=measure('sustained',fixtures['sustained'],2000+index)
            duration+=item['audioSeconds']; index+=1
        report['summary']={label:summary([v['firstVerifiedSeconds'] for v in report['measurements'] if v['label']==label]) for label in ['cold','warm','cache','corpus','sustained']}
        report['sustainedAudioSeconds']=duration
        save()
    finally:
        s.shutdown()

if __name__=='__main__': main()
