"""Inspect local licensed community-review populations; never manufacture grammar gold.

This source review makes no model calls, writes no text corpus and passes no
qualification gate. Community OK labels and self-reported levels are not expert
perfect-grammar labels. Retain the complete downloaded snapshots externally.
"""
import argparse
import bz2
from collections import Counter,defaultdict
from datetime import datetime
import hashlib
from pathlib import Path
import re
from common import read,write,digest,execution_stamp,require_unchanged


def date(value):
    if value in ('','\\N'):return None
    try:return datetime.fromisoformat(value)
    except ValueError:return None


def review_state(case,reviews,level5):
    """Count only version-bound reviews; self-votes never establish consensus."""
    current={};excluded=Counter();invalid=False
    for user,rating,modified in reviews:
        when=date(modified)
        if rating not in (-1,0,1) or when is None:
            excluded['invalidReview']+=1;continue
        if when<case['modified']:
            excluded['staleReview']+=1;continue
        if user in current:
            excluded['duplicateCurrentReviewer']+=1;invalid=True;continue
        current[user]=rating
    positive={user for user,value in current.items() if value==1 and user in level5 and user!=case['owner']}
    negative={user for user,value in current.items() if value==-1 and user in level5 and user!=case['owner']}
    state='unlabelled'
    if not invalid:
        if len(positive)>=2 and all(value==1 for value in current.values()):state='community-OK'
        elif len(negative)>=2 and all(value==-1 for value in current.values()):state='community-not-OK'
    return state,positive if state=='community-OK' else negative if state=='community-not-OK' else set(),dict(excluded)


def verify_assets(directory):
    manifest=read(directory/'asset-manifest.json')
    if manifest.get('status')!='completed':raise ValueError('Source snapshot is incomplete.')
    names=('english-detailed.tsv.bz2','english-CC0.tsv.bz2','user-languages.tsv','sentence-reviews.tsv')
    for name in names:
        path=directory/name;entry=manifest['files'][name];hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        if path.stat().st_size!=entry['bytes'] or hasher.hexdigest()!=entry['sha256']:
            raise ValueError('Source snapshot checksum differs: '+name)
    return manifest


def inspect(directory,cutoff,cc0_only=True,inventory=None):
    manifest=verify_assets(directory);cc0={};excluded=Counter()
    if not cc0_only and 'CC BY 2.0 FR' not in manifest.get('licence',''):
        raise ValueError('Attributed-text review requires the retained export licence declaration.')
    with bz2.open(directory/'english-CC0.tsv.bz2','rt',encoding='utf-8') as stream:
        for line in stream:
            fields=line.rstrip('\r\n').split('\t')
            if len(fields)!=4 or fields[1]!='eng':raise ValueError('Unexpected CC0 sentence schema.')
            key,_,text,modified=fields
            if key in cc0:raise ValueError('Repeated CC0 sentence id.')
            cc0[key]=(text,modified)
    levels=defaultdict(set)
    with (directory/'user-languages.tsv').open(encoding='utf-8') as stream:
        for line in stream:
            fields=line.rstrip('\r\n').split('\t',3)
            # The public details column contains unquoted literal newlines.
            # Never reconstruct or interpret descriptions as proficiency data.
            if len(fields)<3 or not re.fullmatch(r'(?:[a-z]{3,4})?',fields[0]) or fields[1] not in {'0','1','2','3','4','5'} or not re.fullmatch(r'[\w.-]+',fields[2]):
                excluded['unstructuredLanguageDescriptionLine']+=1;continue
            language,level,user=fields[:3]
            if language=='eng':levels[user].add(level)
    level5={user for user,values in levels.items() if values=={'5'}}
    cases={}
    with bz2.open(directory/'english-detailed.tsv.bz2','rt',encoding='utf-8') as stream:
        for line in stream:
            fields=line.rstrip('\r\n').split('\t')
            if len(fields)!=6 or fields[1]!='eng':raise ValueError('Unexpected detailed sentence schema.')
            key,_,text,owner,created,modified=fields
            if cc0_only and key not in cc0:continue
            if key in cc0 and cc0[key]!=(text,modified):excluded['inconsistentCC0Snapshot']+=1;continue
            created,modified=date(created),date(modified)
            if created is None or modified is None or owner in ('','\\N'):
                excluded['missingOwnerOrDate']+=1;continue
            if not 6<=len(re.findall(r'\S+',text))<=80:excluded['outsideWordWindow']+=1;continue
            if key in cases:raise ValueError('Repeated eligible sentence id.')
            cases[key]={'owner':owner,'created':created,'modified':modified,
              'textSHA256':digest(text.casefold()),'sourceSHA256':digest(text)}
    duplicates=Counter(case['textSHA256'] for case in cases.values())
    retained={key:case for key,case in cases.items() if duplicates[case['textSHA256']]==1}
    excluded['duplicateSourceText']=len(cases)-len(retained);cases=retained
    reviews=defaultdict(list)
    with (directory/'sentence-reviews.tsv').open(encoding='utf-8') as stream:
        for line in stream:
            fields=line.rstrip('\r\n').split('\t')
            if len(fields)!=5:raise ValueError('Unexpected review schema.')
            user,key,rating,_,modified=fields
            if key not in cases:continue
            try:rating=int(rating)
            except ValueError:excluded['invalidReviewRating']+=1;continue
            reviews[key].append((user,rating,modified))
    label='all-CC0' if cc0_only else 'all-attributed-English'
    populations={name:{'states':Counter(),'owners':defaultdict(set),'reviewers':defaultdict(set),
      'ownerCounts':defaultdict(Counter),'reviewerCounts':defaultdict(Counter),'eligible':0}
                 for name in (label,'created-after-cutoff')}
    for key,case in cases.items():
        state,raters,invalid=review_state(case,reviews[key],level5);excluded.update(invalid)
        if inventory is not None and state!='unlabelled':
            inventory.append({'sentenceID':key,'sourceSHA256':case['sourceSHA256'],'owner':case['owner'],
              'created':case['created'].isoformat(),'modified':case['modified'].isoformat(),
              'reviewers':sorted(raters),'communityReview':state,'textLicence':'CC0' if key in cc0 else 'CC BY 2.0 FR',
              'attributionProject':'Tatoeba','attributionURL':'https://tatoeba.org'})
        for name,population in populations.items():
            if name=='created-after-cutoff' and case['created']<cutoff:continue
            population['eligible']+=1;population['states'][state]+=1
            if state!='unlabelled':
                population['owners'][state].add(case['owner']);population['reviewers'][state].update(raters)
                population['ownerCounts'][state][case['owner']]+=1
                population['reviewerCounts'][state].update(raters)
    return {'status':'unverified','scope':__doc__,'assetManifestSHA256':digest(manifest),
      'cutoff':cutoff.isoformat(),'textScope':label,'englishCC0Sentences':len(cc0),'selfReportedLevel5Reviewers':len(level5),
      'exclusions':dict(excluded),'populations':{name:{'eligibleSentences':p['eligible'],'states':dict(p['states']),
        'declaredOwnersByState':{key:len(value) for key,value in p['owners'].items()},
        'reviewersByState':{key:len(value) for key,value in p['reviewers'].items()},
        'largestOwnerFractionByState':{key:max(value.values())/p['states'][key] for key,value in p['ownerCounts'].items()},
        'largestReviewerFractionByState':{key:max(value.values())/p['states'][key] for key,value in p['reviewerCounts'].items()},
        'ownerCapPotentialByState':{key:{str(cap):sum(min(count,cap) for count in value.values()) for cap in (1,2,3,4,5)}
          for key,value in p['ownerCounts'].items()}}
        for name,p in populations.items()},
      'limitations':['Community review is experimental, not an expert error-free grammar label.',
        'Proficiency is self-reported; owner identity need not be original authorship.',
        'Unquoted multiline profile descriptions are ignored; only structurally valid language/level/username prefixes are used.',
        'Reviewer overlap and contributor concentration require a separate independence audit.',
        'Recent creation is not proof of absent pretraining overlap.',
        'No corpus exported, model queried, TMU label changed or approval gate passed.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--created-after',required=True,help='Prospectively declared ISO date; no score-based selection')
    parser.add_argument('--include-attributed-text',action='store_true',help='Inspect the broader CC BY English snapshot; preserve attribution, never export its prose')
    parser.add_argument('--inventory-output',help='Optional local IDs, source hashes and attribution metadata only; no prose or model calls')
    args=parser.parse_args();cutoff=date(args.created_after)
    if cutoff is None:raise ValueError('Invalid source-creation cutoff.')
    if args.inventory_output and Path(args.inventory_output).exists():raise ValueError('Preserve the existing candidate inventory.')
    inventory=[] if args.inventory_output else None
    stamp=execution_stamp(__file__);result=inspect(args.directory,cutoff,not args.include_attributed_text,inventory);require_unchanged(stamp)
    result['implementationSHA256']=digest(stamp);write(args.output,result)
    if inventory is not None:
        write(args.inventory_output,{'status':'unverified','scope':'Community-review candidate metadata only; no grammar gold, prose export or inference.',
          'inspectionSHA256':digest(result),'assetManifestSHA256':result['assetManifestSHA256'],
          'entries':inventory,'entriesSHA256':digest(inventory)})
    print(__import__('json').dumps({'populations':result['populations'],'status':result['status']}))


if __name__=='__main__':main()
