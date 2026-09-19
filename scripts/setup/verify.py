"""Real model, publishing and installed desktop checks; no fake success markers."""
import json
import os
from pathlib import Path
import sys
from common import SetupError, run, write_json, read_json
from install import executable, resource_dir


def worker(python,script,model,request,workspace,env,logs,label):
    request={'id':'setup-probe',**request}
    log=run([python,'-s',script,'--model',model],workspace,env,logs,label,timeout=900,input=json.dumps(request)+'\n')
    reply={}
    for line in log.read_text(encoding='utf-8',errors='replace').splitlines():
        try:
            value=json.loads(line)
            if isinstance(value,dict) and value.get('id')=='setup-probe':reply=value
        except ValueError:pass
    if not reply.get('ok'):raise SetupError('ALDER_CAPABILITY',f'{label} failed: {reply.get("error","No worker reply")}. See {log}')
    return reply


def capabilities(workspace,resources,target,env,logs):
    workspace=Path(workspace);resources=Path(resources);logs=Path(logs)
    layout=read_json(workspace/'backend/alder/runtime-layout.json')[target.rsplit('-',1)[0]]
    clean={**env,'ALDER_RESOURCES_DIR':str(resources),'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1',
           'ALDER_SPEECH_DEVICE':'cpu','PYTHONPATH':str(resources/'speech/chatterbox/src')}
    clean.pop('PYTHONHOME',None)
    audio=logs/'setup-speech.wav'
    speech=worker(resources/layout['speechPython'],workspace/'backend/alder/speech_worker.py',resources/'speech/models/turbo',
        {'operation':'generate','text':'Alder is ready for writing and reading.','seed':42,'output':str(audio)},workspace,clean,logs,'speech-inference')
    qa=worker(resources/layout['qaPython'],workspace/'backend/alder/speech_qa_worker.py',resources/'speech/qa/models/base.en',
        {'operation':'transcribe','path':str(audio)},workspace,clean,logs,'speech-recognition')
    if not qa.get('transcript','').strip():raise SetupError('ALDER_CAPABILITY','Speech checker returned no recognised words.')
    clean.pop('PYTHONPATH',None)
    run([resources/layout['python'],'-I',workspace/'scripts/verify-publishing-tools.py','--resources',resources,
         '--output',logs/'publishing'],workspace,clean,logs,'publishing',timeout=600)
    run([resources/layout['ffmpeg'],'-y','-i',audio,logs/'setup-speech.mp3'],workspace,clean,logs,'audio-export',timeout=120)
    run([resources/layout['python'],'-s',workspace/'scripts/verify-system-voices.py',
         '--output',logs/'system-voices','--ffmpeg',resources/layout['ffmpeg']],
         workspace,clean,logs,'system-voices',timeout=180)
    report={'speech':speech,'recognition':qa,'publishing':'passed','audioExport':'passed','humanListeningApproval':False}
    report['systemVoices']=read_json(logs/'system-voices/system-voices.json')
    proofreading_args=[resources/layout['python'],'-s',workspace/'scripts/verify-proofreading.py',
                       '--resources',resources,'--output',logs/'proofreading.json']
    if target=='darwin-x64':proofreading_args.append('--rules-only')
    run(proofreading_args,workspace,clean,logs,'proofreading',timeout=300)
    report['proofreading']=read_json(logs/'proofreading.json')
    write_json(logs/'capabilities.json',report)
    return report


def desktop(workspace,app,target,node,env,logs,full=True):
    if target.startswith('linux') and not (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')):
        return {'status':'pending','reason':'Run verify from a graphical desktop session.'}
    environment={**env,'ALDER_DESKTOP_EXECUTABLE':str(executable(app,target)),
                 'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','PYTHONDONTWRITEBYTECODE':'1'}
    environment.pop('ALDER_RESOURCES_DIR',None)
    run([node,'scripts/smoke-desktop.mjs','--packaged'],workspace,environment,logs,'installed-smoke',timeout=120)
    if full:
        run([node,'scripts/test-desktop-lifecycle.mjs','--packaged','--features'],workspace,environment,logs,'installed-lifecycle',timeout=600)
        run([node,'scripts/test-fonts-desktop.mjs','--packaged'],workspace,environment,logs,'installed-fonts',timeout=120)
    return {'status':'passed','lifecycle':bool(full)}
