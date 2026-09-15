"""Real conditioning isolation and cooperative-cancellation check, in test storage."""
import argparse
import array
import wave
import hashlib
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from alder.speech_pipeline import SpeechPipeline

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reference',type=Path,required=True,help='A reference recording of at least 22 seconds.')
parser.add_argument('--recovery',type=Path,help='Optional prose fixture to test after voice isolation.')
parser.add_argument('--data',type=Path,default=Path('work/speech-voice-validation'))
args=parser.parse_args()
root=args.data; root.mkdir(parents=True,exist_ok=True)
s=SpeechPipeline(root,Path.cwd())
report={}
try:
    reference=args.reference
    voices=[]
    for index in range(2):
        output=root/f'reference-{index}.wav'
        subprocess.run([s.runtime['ffmpeg'],'-nostdin','-loglevel','error','-y','-ss',str(index*12),'-i',str(reference),'-t','10','-ar','24000','-ac','1',str(output)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        voices.append(s.add_voice(output,f'Validation Reference {index+1}'))
    s.prepare('default')
    records=[]
    for index,voice in enumerate([{'id':'default','hash':'default'},*voices,{'id':'default','hash':'default'}]):
        target=root/f'isolation-{index}.wav'
        with s._serial:
            result=s._invoke_worker(dict(operation='generate',text='The reader followed each word across the page.',seed=42,settings={},voiceHash=voice['hash'],referencePath=str(s.root/'voices'/voice['id']/'reference.wav') if voice['id']!='default' else None,output=str(target)),timeout=90)
        assert result['ok'],result
        records.append(dict(voice=voice['id'],sha256=hashlib.sha256(target.read_bytes()).hexdigest(),generation=result.get('generation'),seconds=result['seconds']))
    report['conditioning']=records
    report['defaultRestoredExactly']=records[0]['sha256']==records[-1]['sha256']
    samples = []
    for index in (0,3):
        with wave.open(str(root/f'isolation-{index}.wav')) as audio:
            samples.append(array.array('h', audio.readframes(audio.getnframes())))
    assert len(samples[0]) == len(samples[1])
    report['maximumRestoredPcmDifference'] = max(abs(a-b) for a,b in zip(*samples))
    # GPU floating point rounding may cross a PCM16 quantization boundary.
    report['defaultRestoredWithinOnePcmUnit'] = report['maximumRestoredPcmDifference'] <= 1
    assert report['defaultRestoredWithinOnePcmUnit']
    cancel=root/'cancel.flag';cancel.unlink(missing_ok=True)
    with ThreadPoolExecutor(1) as pool:
        future=pool.submit(s._invoke_worker,dict(operation='generate',text='The reader followed the path through the quiet garden and watched the leaves move slowly in the afternoon light, while the sound of the river reached the open window.',seed=45,settings={},voiceHash='default',output=str(root/'cancelled.wav'),cancelPath=str(cancel)),90)
        time.sleep(.15);started=time.monotonic();cancel.touch();result=future.result(timeout=6)
        report['cancellationSeconds']=time.monotonic()-started
        report['cancelled']=bool(result.get('cancelled'))
        assert report['cancelled'],result
    # Optionally test a recovery passage with the supplied narrator reference.
    if args.recovery:
        job=s.submit({'id':'recovery','revision':0,'pronunciation':[]},{'scope':'selection','text':args.recovery.read_text('utf-8'),'voiceId':voices[0]['id']})
        started=time.monotonic()
        while time.monotonic()-started<180:
            job=s.get_job(job['id'])
            if job['status'] in {'ready','needs_review','failed'}:break
            time.sleep(.05)
        report['recovery']={'status':job['status'],'jobId':job['id'],'acceptedSections':sum(c['playbackEligible'] for c in job['chunks']),'sections':len(job['chunks'])}
    (root/'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2),flush=True)
finally:s.shutdown()
