"""Prepare source-bound human-reference guidance for developer evaluation.

References are non-exhaustive examples, not exact-match answers. This map contains
no candidate outputs, preferences or human ranking labels. A reference-assisted
judge requires its own calibration; unassisted evidence cannot qualify it.
"""
import argparse
from collections import Counter
import hashlib
from pathlib import Path
from common import read,records,write,digest,output_path
from conll_documents import compact
from normalize_display import text


def corrected_sentences(content):
    output=[]
    for block in content.strip().split('\n\n'):
        lines=block.splitlines()
        if not lines or not lines[0].startswith('S '):raise ValueError('Invalid M2 source.')
        source=lines[0][2:];tokens=source.split();edits=[];annotators=set()
        for line in lines[1:]:
            fields=line.split('|||')
            if len(fields)!=6 or not fields[0].startswith('A '):raise ValueError('Invalid M2 edit.')
            annotators.add(fields[5])
            if len(annotators)>1:raise ValueError('Use one official annotator per M2 file.')
            bounds=fields[0][2:].split()
            if len(bounds)!=2:raise ValueError('Invalid M2 bounds.')
            start,end=map(int,bounds)
            if start==end==-1:
                if fields[1]!='noop':raise ValueError('Unexpected negative M2 edit.')
                continue
            if not 0<=start<=end<=len(tokens):raise ValueError('M2 edit escaped source.')
            edits.append((start,end,fields[2].split()))
        edits.sort(key=lambda item:(item[0],item[1]))
        previous=None
        for start,end,_ in edits:
            # Insertions at a replacement boundary are valid M2 edits. Stable
            # ordering preserves the file order of repeated insertions there.
            if previous is not None and start<previous[1]:
                raise ValueError('Overlapping or ambiguous M2 edits.')
            previous=(start,end)
        target=tokens.copy()
        for start,end,replacement in reversed(edits):target[start:end]=replacement
        output.append((source,' '.join(target)))
    return output


def prepare(mapping,annotations,detokenize):
    sentences=mapping['sentences'];references={}
    for rows in annotations:
        if len(rows)!=len(sentences):raise ValueError('Reference sentence inventory mismatch.')
        for sentence,(source,target) in zip(sentences,rows):
            if compact(source)!=compact(sentence['source']):raise ValueError('Reference source alignment mismatch.')
            displayed=text(source,detokenize);reference=text(target,detokenize)
            key=digest(displayed)
            entry=references.setdefault(key,{'source':displayed,'references':[]})
            if entry['source']!=displayed:raise ValueError('Reference source identity collision.')
            if reference not in entry['references']:entry['references'].append(reference)
    return references


def validated_map(data):
    if data.get('schemaVersion')!=1 or not isinstance(data.get('sentences'),dict) or not data['sentences']:
        raise ValueError('Invalid reference guidance map.')
    for key,row in data['sentences'].items():
        if not isinstance(row,dict) or set(row)!={'source','references'} or not isinstance(row['source'],str) or not row['source'].strip() or digest(row['source'])!=key:
            raise ValueError('Reference guidance source binding mismatch.')
        refs=row['references']
        if not isinstance(refs,list) or not refs or any(not isinstance(value,str) for value in refs) or len(set(refs))!=len(refs):
            raise ValueError('Invalid reference guidance examples.')
    return data['sentences']


def eligible_pairs(rows,guidance,detokenize):
    """Explicitly exclude reference-copy shortcuts before selecting a new cohort."""
    selected=[];counts=Counter()
    for original in rows:
        if 'displayTransformation' in original:raise ValueError('Select reference cohorts from the original preference pool.')
        if any(system.upper().startswith('REF') for system in original.get('systems',[])):
            counts['referenceSystem']+=1;continue
        source=text(original['source'],detokenize)
        entry=guidance.get(digest(source))
        if entry is None or entry['source']!=source:raise ValueError('Missing source-bound reference guidance.')
        a=text(original['a'],detokenize);b=text(original['b'],detokenize)
        if a==b:counts['identicalAfterDisplay']+=1;continue
        if any(compact(candidate)==compact(reference) for candidate in (a,b) for reference in entry['references']):
            counts['exactReferenceMatch']+=1;continue
        selected.append({**original,'source':source,'a':a,'b':b,'group':digest(source),
          'originalPairSHA256':digest(original),'originalGroup':original['group'],
          'displayTransformation':'treebank-display-v1'})
    return selected,dict(counts)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--official-root',type=Path,required=True)
    parser.add_argument('--document-map',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--pairs',help='Optional full preference pool for a separately frozen reference-assisted cohort')
    parser.add_argument('--output-cohort');parser.add_argument('--calibration',type=int,default=80)
    parser.add_argument('--validation',type=int,default=150)
    args=parser.parse_args();target=output_path(args.output)
    if target.exists():raise ValueError('Preserve previous reference guidance.')
    if bool(args.pairs)!=bool(args.output_cohort):raise ValueError('Provide both preference pool and new cohort output.')
    cohort_target=output_path(args.output_cohort) if args.output_cohort else None
    if cohort_target and cohort_target.exists():raise ValueError('Preserve previous reference cohorts.')
    mapping=read(args.document_map)
    files=[args.official_root/'noalt'/f'official-2014.{index}.m2' for index in (0,1)]
    import nltk
    from nltk.tokenize.treebank import TreebankWordDetokenizer
    decoder=TreebankWordDetokenizer()
    detokenize=lambda value:decoder.detokenize(value.split(),convert_parentheses=True)
    sentences=prepare(mapping,[corrected_sentences(path.read_text('utf-8')) for path in files],detokenize)
    result={'schemaVersion':1,'sentences':sentences,'scope':__doc__,
      'provenance':{'documentMapSHA256':digest(mapping),'nltkVersion':nltk.__version__,
        'filesSHA256':{str(path.relative_to(args.official_root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
        'url':'https://www.comp.nus.edu.sg/~nlp/conll14st.html',
        'rights':'Official freely distributed evaluation test release; copyright retained, no redistribution grant asserted'},
      'emptyReferencePolicy':'An empty reference records an official whole-sentence deletion; it does not authorize an empty Alder suggestion.',
      'evaluationPolicy':'Exclude reference systems and exact reference-matching candidates from reference-assisted human-preference calibration; independently calibrate the resulting cohort.'}
    validated_map(result)
    if args.pairs:
        from document_cohort import select
        pool=records(args.pairs);eligible,excluded=eligible_pairs(pool,sentences,detokenize)
        selected,folds=select(eligible,mapping,args.calibration,args.validation)
        cohort_target.write_text(''.join(__import__('json').dumps(row,ensure_ascii=False)+'\n' for row in selected),'utf-8')
        write(str(cohort_target)+'.manifest.json',{'scope':__doc__,'protocol':'reference-assisted-document-cohort-v1',
          'inputPairsSHA256':digest(pool),'guidanceSHA256':digest(result),'documentMapSHA256':digest(mapping),
          'pairsSHA256':digest(selected),'excludedPairs':excluded,'eligiblePairs':len(eligible),
          'counts':{key:{'pairs':sum(row['split']==key for row in selected),'documents':len(value)} for key,value in folds.items()},
          'calibrationValidationDocumentOverlap':0,
          'qualificationScope':'Reference-assisted evaluation only; does not qualify unreferenced runtime judging'})
    write(target,result)
    print({'sources':len(sentences),'referenceCount':sum(len(row['references']) for row in sentences.values())})


if __name__=='__main__':main()
