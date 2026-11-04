"""Durable section planning ahead of the existing bounded audio reserve."""
from copy import deepcopy
from . import system_voices
from .speech_quality import projection_parts, iter_projected_sections

PLAN_THRESHOLD = 250_000
PLAN_BATCH = 64
MAX_SOURCE_BYTES = 40_000_000  # Same authored-data envelope as project validation.


def narration_plan(sources, pronunciation, voice_for, interactive):
    parts, records, offset = [], [], 0
    for index, source in enumerate(sources):
        voice = voice_for(source['voiceId'])
        if voice.get('available') is False:
            raise ValueError(f'{voice["name"]} is not installed on this computer. Choose an available replacement voice.')
        records.append({**{k: source.get(k) for k in ('clipId', 'sectionId')}, 'voice': deepcopy(voice)})
        lead = 80 if interactive and not parts and not system_voices.is_system(voice['id']) else None
        for part in projection_parts(source['text'], pronunciation, voice['id'], lead_chars=lead):
            parts.append([part['sourceStart'] + offset, part['sourceEnd'] + offset, part['paragraphEnd'], index])
        offset += len(source['text']) + 2
    if not parts:
        raise ValueError('Enter some text to narrate.')
    return {'parts': parts, 'cursor': 0, 'sources': records, 'pronunciation': deepcopy(pronunciation), 'occurrences': {}}


def append_sections(job, make_chunk):
    plan = job.get('_narrationPlan')
    if not plan or plan['cursor'] >= len(plan['parts']):
        raise ValueError('The saved narration plan is incomplete. Start a new reading.')
    stop = min(len(plan['parts']), plan['cursor'] + PLAN_BATCH)
    additions, occurrences = [], dict(plan['occurrences'])
    for start, end, paragraph_end, source_index in plan['parts'][plan['cursor']:stop]:
        source = plan['sources'][source_index]
        raw = job['text'][start:end]
        prepared = [{'text': raw, 'sourceStart': 0, 'sourceEnd': len(raw), 'paragraphEnd': paragraph_end}]
        for chunk in iter_projected_sections(raw, plan['pronunciation'], source['voice']['id'], prepared=prepared):
            chunk = make_chunk(chunk, source, start, occurrences)
            if job.get('schemaVersion') == 2:
                chunk.update(verificationStatus='pending', playbackEligible=False)
            additions.append(chunk)
    # Publish a complete batch only. Failure leaves the durable cursor intact.
    job['chunks'].extend(additions)
    plan.update(cursor=stop, occurrences=occurrences)
    job['hasMoreText'] = stop < len(plan['parts'])
    if not job['hasMoreText']:
        job.pop('_narrationPlan')
    return True
