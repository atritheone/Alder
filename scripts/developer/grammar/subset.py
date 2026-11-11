"""Freeze a declared corpus prefix and extract exactly aligned result populations.

Selection follows corpus order, never model output or score. This is for bounded
development screens; it cannot turn a development prefix into a held-out test.
"""
import argparse
import json
from pathlib import Path
from common import corpus,records,write,digest,output_path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',required=True);parser.add_argument('--split',default='development',choices=['development','validation','test'])
    parser.add_argument('--limit',type=int,required=True);parser.add_argument('--results',nargs='+',required=True)
    parser.add_argument('--output',required=True);args=parser.parse_args()
    if args.limit<1:raise ValueError('Prefix size must be positive.')
    data=corpus(args.corpus);cases=[case for case in data['cases'] if case['split']==args.split][:args.limit]
    expected={case['id']:case for case in cases};all_cases={case['id']:case for case in data['cases']}
    if len(cases)!=args.limit:raise ValueError('Corpus split is smaller than requested screen.')
    destination=output_path(args.output)
    selected={**data,'parentCorpusSHA256':digest(data),'selection':{'scope':__doc__,'split':args.split,'prefix':args.limit},'cases':cases}
    outputs=[]
    for number,path in enumerate(args.results):
        rows=records(path);by_id={row['id']:row for row in rows}
        if len(by_id)!=len(rows) or any(row['id'] not in all_cases or row['source']!=all_cases[row['id']]['source'] for row in rows):
            raise ValueError('Repeated, unknown or mismatched result source.')
        if set(expected)-by_id.keys():raise ValueError('Requested prefix is incomplete; retain missing cases rather than selecting a favorable subset.')
        included=[by_id[case['id']] for case in cases]
        output=Path(str(destination)+f'.results-{number}.jsonl')
        output.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in included),'utf-8')
        outputs.append({'input':str(Path(path).resolve()),'inputSnapshotSHA256':digest(rows),
          'output':str(output),'selectedResultsSHA256':digest(included)})
    write(destination,selected);corpus(destination)
    write(str(destination)+'.selection.json',{'parentCorpusSHA256':digest(data),'selectedCorpusSHA256':digest(selected),
      'selection':selected['selection'],'outputs':outputs})
    print(json.dumps({'cases':len(cases),'groups':len({c['group'] for c in cases}),'outputs':len(outputs)}))


if __name__=='__main__':main()
