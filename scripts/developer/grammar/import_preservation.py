"""Freeze public-domain literary preservation diagnostics, without grammar gold.

Published prose can contain errors and historical conventions. An unchanged-text
expectation here is a diagnostic heuristic, never a fully correct human label.
Keep books/authors in one fold and raw downloads outside the checkout.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from common import read,write,digest,output_path,corpus,execution_stamp,require_unchanged


def source_body(text):
    marker=r'^\*{3}[ \t]*(%s) OF (?:THE|THIS) PROJECT GUTENBERG[^\r\n]*\*{3}[ \t]*\r?$'
    starts=list(re.finditer(marker%'START',text,re.M|re.I));ends=list(re.finditer(marker%'END',text,re.M|re.I))
    if len(starts)!=1 or len(ends)!=1 or starts[0].end()>=ends[0].start():
        raise ValueError('Unrecognised or ambiguous source-book boundaries.')
    return text[starts[0].end():ends[0].start()]


def candidates(book,text,segments):
    body=source_body(text);result=[]
    for paragraph in re.finditer(r'\S[\s\S]*?(?=\n[ \t\r]*\n|\Z)',body):
        if not .05*len(body)<=paragraph.start()<=.95*len(body):continue
        raw=paragraph.group();context=' '.join(raw.split())
        if not 40<=len(context)<=1500 or any(char in context for char in '_[]*'):continue
        if re.sub(r'\s','',context)!=re.sub(r'\s','',raw):raise ValueError('Wrapping normalization changed lexical characters.')
        for start,end in segments(context):
            source=context[start:end].strip()
            words=re.findall(r'[^\W\d_]+(?:[\x27’][^\W\d_]+)*',source)
            if not 6<=len(words)<=80 or not source or source.isupper():continue
            if not source.lstrip('\"“‘\x27—– ')[0].isupper() or not re.search(r'[.!?][\"”’\x27)]*$',source):continue
            if source.count('\"')%2 or source.count('“')!=source.count('”') or context.count(source)!=1:continue
            # Some editions use single curly quotation marks. Internal
            # apostrophes in contractions/possessives are not closing quotes.
            singles=re.sub(r'(?<=\w)[‘’](?=\w)','',source)
            if '‘' in singles and singles.count('‘')!=singles.count('’'):continue
            stratum='dialogue' if any(char in source for char in '\"“”‘') else 'narrative'
            result.append({'id':'pg-'+digest([book['id'],paragraph.start(),start,source])[:24],
              'group':'book-'+str(book['id']),'split':book['split'],'source':source,'context':context,
              'dialect':book['dialect'],'profile':'creative','track':'document','stratum':stratum,
              'bookId':book['id'],'sourceBookSHA256':book['sha256'],
              'originalParagraphSHA256':digest(raw),'originalBodyParagraphOffset':paragraph.start(),
              'preservationExpectedUnchanged':True,'labelValidity':'unverified',
              'labelProvenance':'Published original prose; not independently annotated for sentence-level grammar or necessity of edits.'})
    unique={}
    for row in result:unique.setdefault(row['source'].casefold(),row)
    return list(unique.values())


def select(populations,books,per_stratum=50):
    if type(per_stratum) is not int or per_stratum<1:raise ValueError('Invalid preservation sample size.')
    occurrences=Counter(row['source'].casefold() for rows in populations.values() for row in rows)
    selected=[];coverage={};authors={};ids=set()
    for book in books:
        if book['id'] in ids or book['split'] not in ('development','validation','test'):
            raise ValueError('Repeated book or unknown preservation partition.')
        ids.add(book['id']);author=book['author'].casefold()
        if author in authors and authors[author]!=book['split']:raise ValueError('An author crosses preservation partitions.')
        authors[author]=book['split'];pool=[row for row in populations[book['id']] if occurrences[row['source'].casefold()]==1]
        counts={}
        for stratum in ('dialogue','narrative'):
            eligible=sorted((row for row in pool if row['stratum']==stratum),key=lambda row:digest([book['id'],row['id']]))
            if len(eligible)<per_stratum:raise ValueError('Insufficient structurally eligible prose; do not silently change sampling.')
            selected.extend(eligible[:per_stratum]);counts[stratum]=len(eligible)
        coverage[str(book['id'])]=counts
    return selected,coverage


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',required=True)
    parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():raise ValueError('Preserve the frozen literary diagnostic.')
    manifest=read(args.manifest)
    if manifest.get('rights',{}).get('evaluationAllowed') is not True:raise ValueError('Missing source-evaluation rights record.')
    import spacy
    from spacy.lang.en import English
    nlp=English();nlp.add_pipe('sentencizer');stamp=execution_stamp(__file__);populations={}
    for book in manifest['books']:
        if not book['published']<book['died']<1955:raise ValueError('Source chronology does not match the recorded rights basis.')
        path=(args.directory/book['file']).resolve()
        if not path.is_relative_to(args.directory.resolve()):raise ValueError('Source file escaped the retained download directory.')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=book['sha256']:raise ValueError('Source-book snapshot changed.')
        populations[book['id']]=candidates(book,raw.decode('utf-8-sig'),
          lambda value:((sentence.start_char,sentence.end_char) for sentence in nlp(value).sents))
    cases,coverage=select(populations,manifest['books']);require_unchanged(stamp)
    data={'schemaVersion':1,'rights':manifest['rights'],'cases':cases,
      'sourceManifestSHA256':digest(manifest),'importerSHA256':digest(stamp),'spacyVersion':spacy.__version__,
      'scope':__doc__,'sampling':'100 sentences/book, 50 dialogue and 50 narrative; middle 90% of body, structural filters, fixed hash order, cross-book duplicate removal. Whole books/authors retain prospective folds.',
      'limitations':['Nine books/authors; only three per fold','Not human sentence-level grammar gold',
        'Historical prose and possible transcription errors','Known pretraining overlap is unknown and likely for famous works',
        'Document track has no automatic clean-text pass labels; changes require separate editorial assessment']}
    write(target,data);corpus(target)
    write(str(target)+'.manifest.json',{'status':'unverified','corpusSHA256':digest(data),'cases':len(cases),
      'coverage':coverage,'sourceManifestSHA256':digest(manifest),'importerSHA256':digest(stamp),
      'foldCases':dict(Counter(case['split'] for case in cases)),
      'scope':'Literary preservation diagnostic only; no inference, editorial approval or expanded qualification claim.'})
    print(json.dumps({'cases':len(cases),'foldCases':dict(Counter(case['split'] for case in cases))}))


if __name__=='__main__':main()
