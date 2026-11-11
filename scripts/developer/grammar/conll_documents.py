"""Align CoNLL-2014 sentence indices to the official source essays.

The official release is freely distributed for evaluation. Preserve its copyright
and exact archive hash outside the checkout; no redistribution grant is inferred.
Sentence-cluster confidence bounds are not document-cluster confidence bounds.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import re
from common import write,digest


class Essays(HTMLParser):
    def __init__(self):
        super().__init__();self.documents=[];self.document=None;self.in_text=False;self.in_paragraph=False
    def handle_starttag(self,tag,attrs):
        if tag=='doc':
            self.document={'id':dict(attrs)['nid'],'paragraphs':[]};self.documents.append(self.document)
        elif tag=='text':self.in_text=True
        elif tag in ('p','title') and self.in_text:self.in_paragraph=True;self.document['paragraphs'].append('')
    def handle_endtag(self,tag):
        if tag=='text':self.in_text=False
        elif tag in ('p','title'):self.in_paragraph=False
    def handle_data(self,data):
        if self.in_text and self.in_paragraph:self.document['paragraphs'][-1]+=data


def compact(text):
    text=re.sub(r'\s+','',text)
    for token,value in (('-LRB-','('),('-RRB-',')'),('-LSB-','['),('-RSB-',']'),
                        ('-LCB-','{'),('-RCB-','}'),('``','"'),("''",'"')):
        text=text.replace(token,value)
    return text


def align(documents,sources):
    rows=[];index=0
    for document in documents:
        remaining=compact(''.join(document['paragraphs']))
        while remaining:
            if index>=len(sources):raise ValueError('Official documents exceed sentence inventory.')
            sentence=compact(sources[index])
            if not remaining.startswith(sentence):
                raise ValueError(f'Unaligned official document {document["id"]}, sentence {index}: {remaining[:90]!r} versus {sentence[:90]!r}')
            rows.append({'sourceIndex':index,'source':sources[index],
              'documentGroup':'conll14-document-'+document['id'],'sourceSHA256':digest(sources[index])})
            index+=1;remaining=remaining[len(sentence):]
    if index!=len(sources):raise ValueError('Unconsumed official source sentences.')
    return rows


def source_clusters(mapping):
    """Union documents sharing identical source text, never guess a duplicate's origin."""
    groups={row['documentGroup']:row['documentGroup'] for row in mapping['sentences']}
    def root(value):
        while groups[value]!=value:
            groups[value]=groups[groups[value]];value=groups[value]
        return value
    sources={}
    for row in mapping['sentences']:
        key=digest(row['source']);group=row['documentGroup']
        if key in sources:
            a,b=root(group),root(sources[key]);groups[max(a,b)]=min(a,b)
        else:sources[key]=group
    return {key:root(group) for key,group in sources.items()}


def main():
    from pathlib import Path
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--official-root',type=Path,required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    sgml=args.official_root/'noalt/official-2014.0.sgml'
    m2=args.official_root/'noalt/official-2014.combined.m2'
    essays=Essays();essays.feed(sgml.read_text('utf-8'))
    sources=[block.splitlines()[0][2:] for block in m2.read_text('utf-8').strip().split('\n\n')]
    rows=align(essays.documents,sources)
    write(args.output,{'documents':essays.documents,'sentences':rows,'alignmentSHA256':digest(rows),
      'provenance':{'url':'https://www.comp.nus.edu.sg/~nlp/conll14st.html','release':'3.2',
        'filesSHA256':{str(p.relative_to(args.official_root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (sgml,m2,args.official_root/'README')},
        'rights':'Official freely distributed evaluation test release; copyright retained, no redistribution grant asserted'},
      'scope':__doc__})
    print(__import__('json').dumps({'documents':len(essays.documents),'sentences':len(rows)}))


if __name__=='__main__':main()
