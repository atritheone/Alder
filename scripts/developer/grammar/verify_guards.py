"""Measure deterministic rejection of known harmful controls against a Git baseline."""
import argparse
from collections import Counter
import hashlib
import subprocess
import sys
from common import ROOT,records,write,digest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--baseline-revision',default='HEAD')
    args=parser.parse_args()
    sys.path.insert(0,str(ROOT/'backend'))
    from alder.proofreading.revisions import revision
    revision_id=subprocess.check_output(['git','rev-parse',args.baseline_revision],cwd=ROOT,text=True).strip()
    original=subprocess.check_output(['git','show',revision_id+':backend/alder/proofreading/revisions.py'],cwd=ROOT).decode('utf-8')
    namespace={'__name__':'alder.proofreading.evaluation_baseline','__package__':'alder.proofreading'}
    exec(compile(original,'<committed-revision-baseline>','exec'),namespace)
    baseline=namespace['revision']
    rows=records(args.pairs);counts={}
    for name,validator in [('baseline',baseline),('candidate',revision)]:
        totals=Counter();failures=[]
        for pair in rows:
            bad=pair['b'] if pair['correctWinner']=='A' else pair['a']
            blocked=validator(pair['source'],bad,[]) is None
            totals[pair['category']]+=int(blocked)
            if not blocked:failures.append(pair['id'])
        counts[name]={'blocked':sum(totals.values()),'categories':dict(totals),'missed':failures}
    write(args.output,{'status':'passed' if counts['candidate']['blocked']==len(rows) and rows else 'failed',
      'scope':'Known controlled harmful mutations only; not general semantic qualification',
      'baselineGitRevision':revision_id,'baselineImplementationSHA256':hashlib.sha256(original.encode()).hexdigest(),
      'candidateImplementationSHA256':digest({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'backend/alder/proofreading').glob('*.py')}),
      'pairsSHA256':digest(rows),'cases':len(rows),'results':counts})


if __name__=='__main__':main()
