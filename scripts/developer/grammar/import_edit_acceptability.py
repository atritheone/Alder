"""Inspect published SEEDA edit-validity labels, separately from sentence quality.

No model inference or label repair. A strict positive means every available
annotator accepted every proposed edit, not that the resulting sentence is fully
correct. Malformed or unaligned annotations quarantine the complete source.
"""
import argparse
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
from common import digest,read,write,output_path
from conll_documents import compact,source_clusters

REVISION='f1b7d88f7b1c0b5701696198800cc42266d02da5'
EDIT=re.compile(r'\[([^\[\]]*?)→([^\[\]]*?)\|(True|False)\]')


def correction(value):
    source=[];target=[];votes=[];position=0
    for match in EDIT.finditer(value):
        source.extend((value[position:match.start()],match[1]))
        target.extend((value[position:match.start()],match[2]))
        votes.append(match[3]=='True');position=match.end()
    source.append(value[position:]);target.append(value[position:])
    before,after=''.join(source),''.join(target)
    if '→' in before or '→' in after or re.search(r'\|(?:True|False)',before+after):
        raise ValueError('MalformedEditMarkup')
    return before,after,votes


def parse_file(content,sources):
    matches=re.findall(r'<t>(.*?)</t>',content,re.S)
    if len(matches)!=1:raise ValueError('AmbiguousSourceTag')
    marked=matches[0]
    alternatives={compact(marked),compact(marked.replace('[','').replace(']',''))}
    identities={source for key in alternatives for source in sources.get(key,[])}
    if len(identities)!=1:raise ValueError('UnalignedSource')
    source=identities.pop()
    if content.count('<Correction>')!=1:raise ValueError('AmbiguousCorrectionSection')
    section=content.split('<Correction>',1)[1]
    targets=re.findall(r'<s(\d+)>(.*?)</s\1>',section,re.S)
    if not targets or len({identifier for identifier,_ in targets})!=len(targets):
        raise ValueError('AmbiguousCorrectionTags')
    # Refuse partially parsed tag sets, including malformed closing tags.
    identifiers=[identifier for identifier,_ in targets]
    if re.findall(r'<s(\d+)>',section)!=identifiers or re.findall(r'</s(\d+)>',section)!=identifiers:
        raise ValueError('IncompleteCorrectionTags')
    rows=[]
    for ordinal,text in targets:
        before,after,votes=correction(text)
        if compact(before)!=compact(source):raise ValueError('UnalignedEditSource')
        rows.append({'ordinal':ordinal,'targetCompact':compact(after),'votes':votes})
    return source,rows


def source_context_indices(content,source,mapping):
    section=content.split('<Correction>',1)[0]
    matches=list(re.finditer(r'<t>(.*?)</t>',section,re.S))
    if len(matches)!=1:raise ValueError('AmbiguousSourceContext')
    match=matches[0]
    if compact(source) not in {compact(match[1]),compact(match[1].replace('[','').replace(']',''))}:
        raise ValueError('SourceContextTargetMismatch')
    context=(section[:match.start()]+source+section[match.end():]).split('<Source with context>',1)[-1]
    sentences=mapping['sentences'];indices=[]
    for index,row in enumerate(sentences):
        if row['source']!=source:continue
        # The published windows sometimes cross essay boundaries. Use them
        # only to recover identity; model context below stays in the essay.
        window=' '.join(item['source'] for item in sentences[max(0,index-1):min(len(sentences),index+2)])
        if compact(window)==compact(context):indices.append(index)
    if not indices:raise ValueError('UnalignedSourceContext')
    return indices


def original_contexts(indices,mapping):
    sentences=mapping['sentences'];contexts=set()
    for index in indices:
        group=sentences[index]['documentGroup']
        contexts.add('\n'.join(sentences[i]['source'] for i in range(max(0,index-1),min(len(sentences),index+2))
            if sentences[i]['documentGroup']==group))
    return sorted(contexts)


def original_context_windows(indices,mapping):
    sentences=mapping['sentences'];windows={}
    for index in indices:
        group=sentences[index]['documentGroup']
        neighbours=[i for i in range(max(0,index-1),min(len(sentences),index+2))
            if sentences[i]['documentGroup']==group]
        value={'sentences':[sentences[i]['source'] for i in neighbours],'target':neighbours.index(index)}
        windows[digest(value)]=value
    return [windows[key] for key in sorted(windows)]


def inspect(root,mapping,inspected_files=(),include_context=False):
    root=Path(root).resolve()
    if subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip():
        raise ValueError('SEEDA checkout has unrecorded changes.')
    revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unexpected SEEDA source revision.')
    outputs={path.stem:path.read_text('utf8').splitlines() for path in sorted((root/'outputs/all').glob('*.txt'))}
    originals=outputs['INPUT'];sources=defaultdict(set);targets=defaultdict(dict)
    if any(len(rows)!=len(originals) for rows in outputs.values()):raise ValueError('Unaligned SEEDA outputs.')
    for index,source in enumerate(originals):
        sources[compact(source)].add(source)
        for system,rows in outputs.items():
            target=rows[index];key=compact(target)
            if key in targets[source] and targets[source][key]!=target:
                # Presentation differences are not new independent candidates.
                continue
            targets[source][key]=target
    clusters=source_clusters(mapping)
    if any(digest(source) not in clusters for source in originals):raise ValueError('Incomplete official document alignment.')
    documents=sorted(set(clusters.values()),key=lambda group:digest(['document-cohort-v1',group]))
    calibration=set(documents[:len(documents)//3])
    observations=defaultdict(lambda:defaultdict(list));context_sources=defaultdict(set)
    quarantined=set();excluded=Counter();files={};exposed=set();pending=[]
    inspected_files={str(Path(name)) for name in inspected_files}
    paths=sorted((root/'data/EditEval_Step1').glob('*/*.txt'))
    known={str(path.relative_to(root)) for path in paths}
    if not inspected_files<=known:raise ValueError('Unknown inspected annotation file.')
    for path in paths:
        name=str(path.relative_to(root));content=path.read_text('utf8')
        files[name]=hashlib.sha256(path.read_bytes()).hexdigest()
        # Source-only alignment allows complete-source quarantine even when an
        # edit is malformed. Never guess or rewrite a malformed human label.
        source=None
        marked=re.findall(r'<t>(.*?)</t>',content,re.S)
        if len(marked)==1:
            identities={s for value in (marked[0],marked[0].replace('[','').replace(']','')) for s in sources.get(compact(value),[])}
            if len(identities)==1:source=identities.pop()
            elif identities:
                # An ambiguous source must not silently erase one annotator's
                # unavailable vote while retaining other positive observations.
                quarantined.update(identities)
        if name in inspected_files and source is not None:exposed.add(clusters[digest(source)])
        try:
            aligned,rows=parse_file(content,sources)
            if any(row['targetCompact'] not in targets[aligned] for row in rows):raise ValueError('UnalignedEditTarget')
            indices=source_context_indices(content,aligned,mapping) if include_context else []
            pending.append((path.parent.name,aligned,rows,indices))
        except ValueError as error:
            excluded[str(error)]+=1
            if source is not None:quarantined.add(source)
    for annotator,source,rows,indices in pending:
        if source in quarantined:continue
        for row in rows:
            target=targets[source][row['targetCompact']]
            if not row['votes'] or compact(source)==compact(target):
                excluded['NoProposedEdits']+=1;continue
            observations[(source,target)][annotator].append(all(row['votes']))
            context_sources[(source,target)].update(indices)
    cases=[]
    for (source,target),annotators in sorted(observations.items()):
        document=clusters[digest(source)]
        if document in exposed:excluded['InspectedSourceDocument']+=1;continue
        if len(annotators)<2:excluded['FewerThanTwoAnnotators']+=1;continue
        if any(len(set(votes))>1 for votes in annotators.values()):
            excluded['InconsistentRepeatedAnnotator']+=1;continue
        key=digest([source,target]);positive=all(votes[0] for votes in annotators.values())
        cases.append({'id':'edit-acceptability-'+key[:24],'source':source,'a':target,'b':source,
          'group':digest(source),'documentGroup':document,
          'split':'calibration' if document in calibration else 'validation',
          'humanEditsAcceptable':positive,'humanAnnotators':len(annotators),
          'humanRecordCount':sum(map(len,annotators.values())),
          'labelScope':'All available independent annotators accepted all edits; not complete-sentence correctness.'})
        if include_context:
            indices=sorted(context_sources[(source,target)])
            cases[-1].update(contextSourceIndices=indices,contexts=original_contexts(indices,mapping),
                contextWindows=original_context_windows(indices,mapping),
                contextPolicy='All recovered original physical-essay neighbour windows; no correction labels in context.')
    counts={}
    for fold in ('calibration','validation'):
        population=[row for row in cases if row['split']==fold];positives=[row for row in population if row['humanEditsAcceptable']]
        counts[fold]={'cases':len(population),'sources':len({row['group'] for row in population}),
          'documents':len({row['documentGroup'] for row in population}),
          'strictPositiveCases':len(positives),'positiveSources':len({row['group'] for row in positives}),
          'positiveDocuments':len({row['documentGroup'] for row in positives}),
          'maximumOracleApprovalsAt95Precision':len(positives)*20//19}
    return cases,{'status':'unverified','scope':__doc__,'revision':revision,'counts':counts,
      'sourceFiles':len(paths),'annotationFilesSHA256':files,'quarantinedSources':len(quarantined),
      'structuralExclusions':dict(excluded),'inspectedFiles':sorted(inspected_files),'excludedInspectedDocuments':sorted(exposed),
      'documentMapSHA256':digest(mapping),'casesSHA256':digest(cases),
      'sourceContextIncluded':include_context,
      'outputsSHA256':{name:hashlib.sha256((root/'outputs/all'/f'{name}.txt').read_bytes()).hexdigest() for name in outputs},
      'limitations':['No malformed annotation repaired; complete source quarantined on an unaligned/malformed correction.',
        'Other labels mean lack of unanimous approval, not proof of an ungrammatical or unfaithful edit.',
        'Published source may occur in pretraining. Prior evaluator studies remain separate and are not erased.',
        'Public local research analysis only; no production training or redistribution grant asserted.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seeda',type=Path,required=True);parser.add_argument('--document-map',required=True)
    parser.add_argument('--inspected-files',nargs='*',default=[]);parser.add_argument('--output',required=True)
    parser.add_argument('--include-context',action='store_true',help='Recover original annotation source identities and attach original essay neighbours')
    args=parser.parse_args();target=output_path(args.output)
    if target.exists():raise ValueError('Preserve an existing cohort; use a new output path.')
    cases,report=inspect(args.seeda,read(args.document_map),args.inspected_files,args.include_context)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in cases),'utf8')
    report['importerSHA256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    write(str(target)+'.manifest.json',report)
    print(json.dumps({'status':'unverified','counts':report['counts'],'structuralExclusions':report['structuralExclusions']}))


if __name__=='__main__':main()
