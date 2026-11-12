"""Freeze every human-ranked source in the existing held-out document fold.

Eligibility uses published source IDs, never ranks, model judgments, output
quality, length or availability. Keep the original run as a separate failed
diagnostic. Its human-eligible cases retain exactly the same pair identities.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from common import read,records,digest,write,output_path
from conll_documents import source_clusters
from human_rankings import source_indices
from normalize_display import pairs as normalize_pairs
from peer_ranking import prepare,shape,verify_source

PROTOCOL='all-human-ranked-heldout-documents-v1'


def build(original,raw_map,shown,outputs,cohort,human_ids,detokenize):
    old_pairs=prepare(original,raw_map,shown,outputs,cohort)
    old_sources,_=shape(old_pairs);clusters=source_clusters(shown)
    folds={split:{clusters[digest(p['source'])] for p in cohort if p['split']==split}
           for split in ('calibration','validation')}
    if not folds['calibration'] or not folds['validation'] or folds['calibration']&folds['validation']:
        raise ValueError('Use the original disjoint calibration/validation document folds.')
    if any(type(i) is not int or not 0<=i<len(shown['sentences']) for i in human_ids):
        raise ValueError('Human ranking source index is outside the document map.')
    eligible={i for i in human_ids if clusters[digest(shown['sentences'][i]['source'])] in folds['validation']}
    retained=set(old_sources)&eligible;added=eligible-set(old_sources);excluded=set(old_sources)-eligible
    matrix=[row for row in original if row['sourceIndex'] in retained]
    raw_rows=[]
    for i in sorted(added):
        source=raw_map['sentences'][i]['source']
        for system,values in sorted(outputs.items()):
            raw_rows.append({'id':'rank-'+digest([i,system])[:24],'group':digest(source),
                'split':'validation','source':source,'sourceIndex':i,'system':system,'a':values[i],'b':source})
    rendered,_=normalize_pairs(raw_rows,detokenize,unlabelled_ranking_matrix=True)
    matrix+=rendered
    pairs=prepare(matrix,raw_map,shown,outputs,cohort);by_id={pair['id']:pair for pair in pairs}
    for pair in old_pairs:
        if pair['sourceIndex'] in retained and by_id.get(pair['id'])!=pair:
            raise ValueError('An original human-eligible pair changed during population repair.')
    audit={'protocol':PROTOCOL,'originalSources':len(old_sources),'sources':len(eligible),
        'retainedOriginalSourceIndices':sorted(retained),'excludedUnratedOriginalSourceIndices':sorted(excluded),
        'addedHumanRatedSourceIndices':sorted(added),'eligibleSourceIndices':sorted(eligible),
        'uniqueSourceTexts':len({shown['sentences'][i]['source'] for i in eligible}),
        'heldOutDocumentGroups':len(folds['validation']),'calibrationDocumentOverlap':0,
        'originalMatrixSHA256':digest(original),'originalPairsSHA256':digest(old_pairs),
        'matrixSHA256':digest(matrix),'pairsSHA256':digest(pairs),'cohortSHA256':digest(cohort),
        'rawMapSHA256':digest(raw_map),'displayMapSHA256':digest(shown),
        'humanSourceIndicesSHA256':digest(sorted(human_ids)),
        'implementationSHA256':digest({name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in ('ranking_population.py','human_rankings.py','peer_ranking.py','normalize_display.py',
                         'contextualize_pairs.py','conll_documents.py','common.py')}),
        'selection':__doc__,'modelInferencePerformed':False}
    return matrix,pairs,audit


def inputs(paths):
    import nltk
    from nltk.tokenize.treebank import TreebankWordDetokenizer
    root=Path(paths['seeda']);revision=verify_source(root)
    outputs={p.stem:p.read_text('utf8').splitlines() for p in (root/'outputs/all').glob('*.txt')}
    human_data=(root/'data/judgments_sent.xml').read_bytes()
    human=source_indices(ET.fromstring(human_data).iter('ranking-item'),len(outputs['INPUT']))
    decoder=TreebankWordDetokenizer()
    result=build(records(paths['originalMatrix']),read(paths['rawMap']),read(paths['displayMap']),outputs,
        records(paths['cohort']),human,lambda value:decoder.detokenize(value.split(),convert_parentheses=True))
    result[2].update(seedaRevision=revision,humanJudgmentsSHA256=hashlib.sha256(human_data).hexdigest(),nltkVersion=nltk.__version__)
    return result


def verify_manifest(manifest):
    if manifest.get('protocol')!=PROTOCOL:raise ValueError('Unknown ranking-population protocol.')
    matrix,pairs,audit=inputs(manifest['inputs'])
    for key,value in audit.items():
        if manifest.get(key)!=value:raise ValueError('Ranking population differs from its frozen source-only selection: '+key)
    return matrix,pairs,audit


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('seeda','original-matrix','raw-map','display-map','cohort','output-prefix'):
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args();paths={'seeda':args.seeda,'originalMatrix':args.original_matrix,
        'rawMap':args.raw_map,'displayMap':args.display_map,'cohort':args.cohort}
    matrix,pairs,audit=inputs(paths)
    if audit['originalSources']!=100 or audit['sources']<112 or audit['uniqueSourceTexts']<100:
        raise ValueError('Expected the original 100-source diagnostic and enough human-rated sources for the unchanged coverage gate.')
    prefix=Path(args.output_prefix)
    targets=[output_path(str(prefix)+suffix) for suffix in ('.matrix.jsonl','.pairs.jsonl','.manifest.json')]
    if any(path.exists() for path in targets):raise ValueError('Preserve previous populations and reports.')
    for path,rows in zip(targets,(matrix,pairs)):
        path.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows),'utf8')
    write(targets[2],{**audit,'inputs':paths,'matrix':str(targets[0]),'pairs':str(targets[1]),
        'scope':'One full eligibility repair for every judge; no further outcome-dependent population expansions.'})
    print(json.dumps({k:audit[k] for k in ('sources','originalSources','heldOutDocumentGroups','pairsSHA256')}))


if __name__=='__main__':main()
