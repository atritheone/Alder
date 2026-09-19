"""Measure real first accepted audio, independently of renderer/audio output latency."""
import argparse
import json
from pathlib import Path
import time

from alder.speech_pipeline import SpeechPipeline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--engine', choices=['sapi', 'chatterbox'], required=True)
    parser.add_argument('--prepared', action='store_true', help='Prepare the selected voice before measuring Play, as the reader does on open.')
    parser.add_argument('--paragraphs', type=int, default=1)
    args = parser.parse_args()
    service = SpeechPipeline(Path(args.data), Path.cwd())
    voice = next(v['id'] for v in service.voices() if v['id'].startswith('sapi-')) if args.engine == 'sapi' else 'default'
    text = 'Alder brings words to life, helping a writer collect an idea and shape a sentence before listening carefully to the rhythm and meaning of the complete passage.'
    text = '\n\n'.join([text] * args.paragraphs)
    project = {'id': 'latency-benchmark', 'revision': 0, 'pronunciation': []}
    results = []
    try:
        if args.prepared:
            started = time.monotonic()
            service.prepare(voice)
            print(json.dumps({'engine': args.engine, 'preparationMs': (time.monotonic() - started) * 1000}), flush=True)
        for label, seed in [('cold', 702), ('warm', 703), ('cache', 703)]:
            if args.prepared and label == 'cold': label = 'prepared'
            start = time.monotonic()
            job = service.submit(project, {'scope': 'selection', 'text': text, 'voiceId': voice, 'seed': seed, 'interactive': True})
            submitted = time.monotonic() - start
            while time.monotonic() - start < 180:
                job = service.get_job(job['id'])
                if job['chunks'][0]['playbackEligible']:
                    break
                if job['status'] in {'failed', 'needs_review', 'cancelled'}:
                    raise RuntimeError(json.dumps(job))
                time.sleep(.01)
            else:
                raise TimeoutError('First accepted audio exceeded 180 seconds')
            item = {'engine': args.engine, 'label': label, 'submitMs': submitted * 1000,
                    'firstAcceptedMs': (time.monotonic() - start) * 1000,
                    'firstAudioSeconds': job['chunks'][0].get('seconds'),
                    'sections': len(job['chunks']), 'cached': job['chunks'][0].get('cached')}
            print(json.dumps(item), flush=True)
            results.append(item)
            service.cancel(job['id'])
            while service.get_job(job['id'])['status'] == 'cancelling':
                time.sleep(.02)
        Path(args.data, 'reading-start.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    finally:
        service.shutdown()


if __name__ == '__main__':
    main()
