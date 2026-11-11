"""Import MIT-licensed, human-corrected natural conversations by conversation.

This adds conversational coverage, not universal dialect or literary gold labels.
The source release lacks participant-level links across conversations; report
conversation groups without calling them independently sampled authors.
"""
import argparse
from collections import Counter
import hashlib
from pathlib import Path
import subprocess
from common import write,digest,corpus


def build(root):
    revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    if subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip():
        raise ValueError('Research corpus checkout has unrecorded changes.')
    licence=(root/'LICENSE').read_text('utf-8')
    if 'MIT License' not in licence or 'Copyright (c) 2022 YUAN Xun' not in licence:
        raise ValueError('Unexpected ErAConD licence; inspect before importing.')
    conversations=[];files={}
    for original in sorted((root/'data').glob('*/orig/*.txt')):
        corrected=original.parent.parent/'corr'/original.name
        source_lines=original.read_text('utf-8-sig').splitlines()
        reference_lines=corrected.read_text('utf-8-sig').splitlines()
        if len(source_lines)!=len(reference_lines):raise ValueError('Unaligned conversation references.')
        group='eracond-'+original.parent.parent.name+'-'+original.stem
        conversations.append((group,source_lines,reference_lines))
        for path in (original,corrected):files[str(path.relative_to(root))]=hashlib.sha256(path.read_bytes()).hexdigest()
    # Repeated greetings and other shared utterances are removed across groups,
    # before model inference, so identical source text cannot leak between folds.
    occurrences={}
    for group,sources,_ in conversations:
        for source in sources:occurrences.setdefault(source.strip().casefold(),set()).add(group)
    repeated={source for source,groups in occurrences.items() if len(groups)>1}
    cases=[];excluded=Counter()
    for group,sources,references in conversations:
        fold=int(digest(group)[:8],16)%5
        split='development' if fold<3 else 'validation' if fold==3 else 'test'
        for index,(source,reference) in enumerate(zip(sources,references)):
            source,reference=source.strip(),reference.strip()
            if not source or not reference:excluded['empty']+=1;continue
            if source.casefold() in repeated:excluded['crossConversationDuplicateSource']+=1;continue
            context='\n'.join([*sources[max(0,index-2):index],source])
            if context.count(source)!=1:context=source
            cases.append({'id':group+'-'+str(index),'group':group,'split':split,
              'source':source,'reference':reference,'context':context,
              'dialect':'en-US','profile':'standard','track':'correctness',
              'origin':'ErAConD','sourceDatasetOrigins':['ErAConD'],
              'genre':'learner conversation','sourceDialect':'not annotated',
              'referenceScope':'One human correction; other valid conversational formulations may exist',
              'knownPretrainingOverlap':'unknown'})
    if not cases:raise ValueError('No aligned conversation cases.')
    return {'schemaVersion':1,'rights':{'evaluationAllowed':True,'origin':'ErAConD',
      'licence':'MIT','notice':licence,'attribution':'Yuan, Pham, Davidson and Yu (NAACL 2022)',
      'url':'https://github.com/yuanxun-yx/eracond','revision':revision},
      'filesSHA256':files,'importPolicy':{'group':'conversation, not participant',
        'split':'SHA256 conversation modulo 5: 3 development, 1 validation, 1 test',
        'crossGroupDuplicates':'Exclude all shared source utterances before inference',
        'locale':'US is an evaluation setting, not an inferred source dialect',
        'excluded':dict(excluded)},'cases':cases}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args();data=build(args.root)
    write(args.output,data);corpus(args.output)
    print(__import__('json').dumps({'cases':len(data['cases']),
      'conversations':len({case['group'] for case in data['cases']}),
      'splits':dict(Counter(case['split'] for case in data['cases'])),
      'excluded':data['importPolicy']['excluded'],'sha256':digest(data)}))


if __name__=='__main__':main()
