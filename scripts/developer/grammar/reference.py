"""Score delivered text with the installed official ERRANT implementation.

Reference overlap is diagnostic for full rewrites: a valid paraphrase absent from
the references can count as a false positive. Never use this score alone as an
editorial or semantic qualification verdict.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.metadata
from pathlib import Path
from types import SimpleNamespace
from common import corpus, records, delivered, digest, write, output_path, execution_stamp, require_unchanged


def population(data, results, split):
    expected={case['id']:case for case in data['cases'] if case['split']==split}
    all_ids={case['id']:case for case in data['cases']}
    seen={}
    for row in results:
        if row['id'] not in all_ids or row['id'] in seen or row['source']!=all_ids[row['id']]['source']:
            raise ValueError('Unknown, repeated or source-mismatched reference result.')
        seen[row['id']]=row
    missing=sorted(set(expected)-seen.keys())
    # A missing result is evaluated as the original, retaining all missed edits.
    examples=[]
    for key,case in expected.items():
        refs=case.get('references') or ([case['reference']] if 'reference' in case else [])
        if not refs:continue
        if not all(isinstance(text,str) and text.strip() for text in refs):
            raise ValueError('Reference text must be a nonempty string.')
        examples.append((case,delivered(seen[key]) if key in seen else case['source'],refs))
    return examples,missing,sorted(set(expected)-{case['id'] for case,_,_ in examples})


def reference_groups(references,policy):
    if policy=='official-multi':return [references]
    if policy=='all-independent':return [[reference] for reference in references]
    raise ValueError('Unknown reference aggregation policy.')


def main():
    stamp=execution_stamp(__file__)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',required=True)
    parser.add_argument('--results',required=True)
    parser.add_argument('--split',choices=['development','validation','test'],default='development')
    parser.add_argument('--output',required=True)
    parser.add_argument('--reference-aggregation',choices=['official-multi','all-independent'],default='official-multi',
                        help='All-independent scores every human reference separately, retaining one source/group denominator.')
    args=parser.parse_args()
    data=corpus(args.corpus);results=records(args.results)
    examples,missing,unreferenced=population(data,results,args.split)
    if not examples:raise ValueError('No reference-bearing cases in selected split.')
    import errant
    from errant.commands import compare_m2 as official
    annotator=errant.load('en')
    options=SimpleNamespace(beta=.5,verbose=False,dt=False,ds=False,cs=True,cse=False,
                            single=False,multi=False,filt=[],cat=3)
    counts=Counter(tp=0,fp=0,fn=0);categories={};hypotheses=[];references=[];per_case=[]
    parsed={}
    def parse(text):
        if text not in parsed:parsed[text]=annotator.parse(text,tokenise=True)
        return parsed[text]
    def m2(source,targets):
        original=parse(source)
        lines=['S '+' '.join(token.text for token in original)]
        for index,text in enumerate(targets):
            edits=annotator.annotate(original,parse(text)) if source!=text else []
            lines.extend(edit.to_m2(index) for edit in edits)
            if not edits:lines.append(f'A -1 -1|||noop|||-NONE-|||REQUIRED|||-NONE-|||{index}')
        return '\n'.join(lines)
    for index,(case,proposal,refs) in enumerate(examples):
        hyp,ref=m2(case['source'],[proposal]),m2(case['source'],refs)
        hypotheses.append(hyp);references.append(ref)
        h=official.process_edits(official.simplify_edits(hyp),options)
        case_counts=Counter(tp=0,fp=0,fn=0)
        for group in reference_groups(refs,args.reference_aggregation):
            block=ref if args.reference_aggregation=='official-multi' else m2(case['source'],group)
            r=official.process_edits(official.simplify_edits(block),options)
            count,cat=official.evaluate_edits(h,r,counts,index,case['source'],options)
            counts.update(count);case_counts.update(count);categories=official.merge_dict(categories,cat)
        per_case.append({'id':case['id'],'group':case['group'],'track':case['track'],
          'dialect':case['dialect'],'counts':dict(case_counts),'changed':proposal!=case['source']})
    def score(values):
        tp,fp,fn=values
        p,r,f=official.computeFScore(tp,fp,fn,.5)
        return {'tp':tp,'fp':fp,'fn':fn,'precision':p,'recall':r,'f0.5':f}
    slices=defaultdict(lambda:Counter(tp=0,fp=0,fn=0))
    for case in per_case:
        for dimension in ('track','dialect'):slices[dimension+':'+case[dimension]].update(case['counts'])
    require_unchanged(stamp)
    target=output_path(args.output)
    artifacts={}
    for label,blocks in (('hypothesis',hypotheses),('reference',references)):
        path=Path(str(target)+'.'+label+'.m2')
        path.write_text('\n\n'.join(blocks)+'\n\n','utf-8')
        artifacts[label]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    write(target,{'status':'unverified','scope':__doc__,'split':args.split,
      'cases':len(examples),'missingResults':missing,'unreferenced':unreferenced,
      'overall':score([counts[k] for k in ('tp','fp','fn')]),
      'categories':{key:score(value) for key,value in sorted(categories.items())},
      'slices':{key:score([value[k] for k in ('tp','fp','fn')]) for key,value in slices.items()},
      'casesScored':per_case,'artifacts':artifacts,'corpusSHA256':digest(data),
      'resultsSHA256':digest(results),'implementationSHA256':digest(stamp),
      'dependencies':{'errant':importlib.metadata.version('errant'),
        'spacy':importlib.metadata.version('spacy'),'en_core_web_sm':importlib.metadata.version('en_core_web_sm')},
      'referenceAggregation':args.reference_aggregation,
      'referenceAssessments':sum(len(reference_groups(refs,args.reference_aggregation)) for _,_,refs in examples),
      'referencePolicy':('Official ERRANT cumulative multi-reference choice' if args.reference_aggregation=='official-multi'
         else 'Every human reference scored separately and summed within source; references are not independent source observations')+
         '; no absent paraphrase can be certified incorrect from overlap alone'})
    print(__import__('json').dumps({'cases':len(examples),'missing':len(missing),'overall':score([counts[k] for k in ('tp','fp','fn')])}))


if __name__=='__main__':main()
