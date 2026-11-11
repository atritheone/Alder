"""Validate blinded, bidirectional judgments. Invalid or unstable ratings abstain."""
import argparse
import json
import subprocess
from common import digest, read, records, write, output_path, ROOT


def validate(value, source, a, b):
    if not isinstance(value,dict) or set(value)!={'winner','defects'} or value.get('winner') not in ('A', 'B', 'tie', 'abstain'):
        raise ValueError('Invalid winner.')
    if not isinstance(value['defects'],list) or len(value['defects'])>2:
        raise ValueError('Invalid defect evidence.')
    for defect in value['defects']:
        if not isinstance(defect,dict) or set(defect)!={'candidate','quote','reason','dimension'} or any(not isinstance(field,str) for field in defect.values()):
            raise ValueError('Invalid defect fields.')
        if defect['candidate'] not in ('A', 'B') or not defect['quote'] or not defect['reason']:
            raise ValueError('Missing defect evidence.')
        text = a if defect['candidate'] == 'A' else b
        if defect['quote'] not in text:
            raise ValueError('Defect quotation is not present in the candidate.')
        if defect['dimension'] not in ('correctness', 'fluency', 'meaning', 'voice', 'dialect', 'completeness'):
            raise ValueError('Invalid defect dimension.')
    if value['winner'] in ('A','B') and not any(d['candidate'] != value['winner'] for d in value['defects']):
        raise ValueError('A decisive preference needs evidence of a defect in the losing candidate.')
    return value['winner']


def adjudicate(first, swapped):
    reverse = {'A': 'B', 'B': 'A', 'tie': 'tie', 'abstain': 'abstain'}
    return first if first == reverse[swapped] else 'abstain'


def calibration_futility(pairs, rows):
    """Stop only when even perfect remaining ratings cannot meet frozen gates."""
    expected={pair['id']:pair for pair in pairs}
    if not expected or len(expected)!=len(pairs) or any(pair.get('humanWinner') not in ('A','B') or pair.get('split')!='calibration' for pair in pairs):
        raise ValueError('Futility requires a nonempty, decisive human calibration population.')
    seen=set();correct=changes=abstentions=0
    reverse={'A':'B','B':'A','tie':'tie','abstain':'abstain'}
    for row in rows:
        key=row['id']
        if key not in expected or key in seen or row['pairSHA256']!=digest(expected[key]):
            raise ValueError('Futility ratings do not match the frozen population.')
        seen.add(key)
        decisions=row.get('orderDecisions',[])
        if len(decisions)!=2 or any(value not in reverse for value in decisions) or row['winner']!=adjudicate(*decisions):
            raise ValueError('Futility requires complete, consistent two-order ratings.')
        correct+=int(row['winner']==expected[key]['humanWinner'])
        changes+=int(decisions[0]!=reverse[decisions[1]])
        abstentions+=int(row['winner']=='abstain')
    total=len(expected);remaining=total-len(seen);reasons=[]
    if 5*(correct+remaining)<4*total:reasons.append('Even perfect remaining ratings cannot reach 80% agreement.')
    if 20*changes>total:reasons.append('Observed order changes already exceed 5% of the complete population.')
    if 10*abstentions>total:reasons.append('Observed abstentions already exceed 10% of the complete population.')
    return {'protocol':'calibration-futility-v1','futile':bool(reasons),'reasons':reasons,
      'requestedCases':total,'recordedCases':len(seen),'remainingCases':remaining,
      'bestPossibleFinalAgreement':(correct+remaining)/total,
      'minimumFinalOrderInstability':changes/total,'minimumFinalAbstentionRate':abstentions/total,
      'scope':'Mathematical early rejection only; cannot qualify an evaluator or inspect held-out ratings.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', required=True)
    parser.add_argument('--judge-config', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--split',choices=['calibration','validation'],default='calibration')
    parser.add_argument('--stop-file',help='Finish the current two-order pair, then stop with resumable evidence')
    parser.add_argument('--futility',action='store_true',help='Stop decisive human calibration at frozen mathematical rejection bounds')
    args = parser.parse_args()
    if args.futility and args.split!='calibration':raise ValueError('Futility is restricted to calibration, not held-out validation.')
    from pathlib import Path
    output_path(args.output)
    if args.stop_file and Path(args.stop_file).resolve().is_relative_to(ROOT):
        raise ValueError('Judge cancellation state must be outside the checkout.')
    config = read(args.judge_config)
    if not config.get('family') or not config.get('modelSHA256') or not isinstance(config['command'], list):
        raise ValueError('A pinned judge identity and explicit argv command are required.')
    if config.get('serverIdentity') and not config.get('preflightCommand'):
        raise ValueError('A local server judge requires an identity-only preflight command.')
    rubric = read(__file__.replace('judge.py', 'rubric.json'))
    from pathlib import Path
    extra=config.get('implementationFiles',[])
    if not isinstance(extra,list) or any(not isinstance(name,str) or Path(name).name!=name or not name.endswith('.py') for name in extra):
        raise ValueError('Judge implementation files must be local Python filenames.')
    implementation={name:digest((Path(__file__).parent/name).read_text('utf-8'))
                    for name in ('judge.py','judge_server.py','judge_client.py','judge_protocol.py','common.py',*extra)}
    rows = []
    pairs=[pair for pair in records(args.pairs) if pair['split']==args.split]
    if args.limit is not None:
        if args.limit<1:raise ValueError('Limit must be positive.')
        pairs=pairs[:args.limit]
    from pathlib import Path
    fingerprint=digest({'judge':config,'rubric':rubric,'implementation':implementation,
                        'pairs':digest(records(args.pairs)),'split':args.split,
                        'futilityProtocol':'calibration-futility-v1' if args.futility else None})
    if Path(args.output).exists():
        previous=read(args.output)
        if previous.get('runFingerprint')!=fingerprint:raise ValueError('Judge resume fingerprint mismatch.')
        rows=previous['records']
    expected={pair['id']:pair for pair in pairs}
    completed=set()
    for row in rows:
        if row['id'] in completed or row['id'] not in expected or row['pairSHA256']!=digest(expected[row['id']]):
            raise ValueError('Judge resume contains unknown, modified or repeated pairs.')
        completed.add(row['id'])
    futility=calibration_futility(pairs,rows) if args.futility else None
    def save(status,**extra):
        write(args.output, {'schemaVersion': 1, 'judge': {k: v for k, v in config.items() if k not in ('command','preflightCommand')},
          'judgeSHA256': digest(config), 'rubricSHA256': digest(rubric),
          'implementationSHA256':digest(implementation),'runFingerprint':fingerprint,
          'requestedCases':len(pairs),'records':rows,'status':status,
          **({'futility':futility} if futility is not None else {}),**extra})
    def unchanged():
        if any(digest((Path(__file__).parent/name).read_text('utf-8'))!=value for name,value in implementation.items()):
            raise ValueError('Judge implementation changed during the run; current pair not recorded.')
    if config.get('preflightCommand'):
        preflight=subprocess.run(config['preflightCommand'],capture_output=True,text=True,encoding='utf-8',timeout=30,check=True)
        if config.get('serverIdentity') and digest(json.loads(preflight.stdout))!=digest(config['serverIdentity']):
            raise ValueError('Preflight server identity differs from the frozen judge.')
    if futility and futility['futile']:save('futile');return
    save('running');stopped=False
    try:
        for pair in pairs:
            if pair['id'] in completed:continue
            if args.stop_file and Path(args.stop_file).exists():stopped=True;break
            unchanged();decisions, errors, responses = [], [], []
            for swapped in (False, True):
                responses.append(None)
                a, b = (pair['b'], pair['a']) if swapped else (pair['a'], pair['b'])
                if pair.get('aAvailable',True) is not True or pair.get('bAvailable',True) is not True:
                    decisions.append('abstain');responses[-1]={'winner':'abstain','defects':[]}
                    errors.append('ComparisonUnavailable');continue
                if a == b:
                    decisions.append('tie'); responses[-1]={'winner':'tie','defects':[]}; continue
                payload = {'source': pair['source'], 'context': pair.get('context', pair['source']),
                           'dialect': pair.get('dialect', 'en-GB'), 'profile': pair.get('profile', 'standard'),
                           'A': a, 'B': b, 'rubric': rubric}
                try:
                    result = subprocess.run(config['command'], input=json.dumps(payload), text=True,
                                            encoding='utf-8', capture_output=True, timeout=config.get('timeout', 120), check=True)
                    response=json.loads(result.stdout)
                    responses[-1]=response
                    decision = validate(response, pair['source'], a, b)
                except (ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
                    decision = 'abstain'; errors.append(type(error).__name__)
                decisions.append(decision)
            unchanged()
            rows.append({'id': pair['id'], 'group': pair['group'], 'split': pair['split'],
                         'pairSHA256': digest(pair), 'winner': adjudicate(*decisions),
                         'orderDecisions': decisions, 'errors': errors, 'responses':responses})
            if args.futility:futility=calibration_futility(pairs,rows)
            save('running')
            print(json.dumps({'id':pair['id'],'winner':rows[-1]['winner'],'errors':errors}),flush=True)
            if futility and futility['futile']:break
        unchanged();save('futile' if futility and futility['futile'] else 'interrupted' if stopped else 'completed')
    except BaseException as error:
        save('interrupted' if isinstance(error,KeyboardInterrupt) else 'invalidated' if isinstance(error,ValueError) else 'failed',errorType=type(error).__name__)
        raise


if __name__ == '__main__':
    main()
