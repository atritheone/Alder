"""Known harmful mutations for evaluator qualification, never training labels."""
import argparse
import json
from common import output_path,write,digest

TEMPLATES=[
 ('{a} must pay {n} dollars before Friday.','{a} may pay {n} dollars before Friday.','modality'),
 ('{a} did not approve the report.','{a} approved the report.','negation'),
 ('{a} paid {n} dollars to {b}.','{a} paid {m} dollars to {b}.','quantity'),
 ('{a} will pay only if {b} approves.','{a} will pay whether or not {b} approves.','condition'),
 ('{a} rejected {b} during the meeting.','{a} was rejected by {b} during the meeting.','agent-patient'),
 ("{a} rejected {b}'s proposal.","{a}'s proposal was rejected by {b}.",'possessive-role'),
 ('{a} paid {n} dollars.','{a} paid {n} euros.','currency-unit'),
 ('{a} owes -{n} dollars.','{a} owes {n} dollars.','signed-quantity')]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--rewritten',action='store_true',help='Both candidates correct an additional grammar error; unchanged-text preference cannot pass')
    args=parser.parse_args()
    names=['Alice','Beth','Clara','Diana','Emma','Fiona','Grace','Helen','Jane','Kate',
           'Laura','Mary','Nina','Nora','Olivia','Paula','Rose','Ruth','Sara','Tara',
           'Uma','Vera','Wendy','Yasmin','Zoe']
    rows=[]
    for kind,(source_template,bad,category) in enumerate(TEMPLATES):
        for number,name in enumerate(names):
            values={'a':name,'b':'Sam','n':str(10+number),'m':str(11+number)}
            source,bad_text=source_template.format(**values),bad.format(**values)
            if category in ('agent-patient','possessive-role') and number%2:
                # Fluency preference for active voice must not masquerade as semantic detection.
                source,bad_text=bad_text,source
            good=source
            if args.rewritten:
                source+=' They has kept a copy.'
                good+=' They have kept a copy.'
                bad_text+=' They have kept a copy.'
            swapped=number%2==1
            rows.append({'id':f'trap-{kind}-{number}','group':f'trap-{kind}',
                'split':'validation','source':source,'a':bad_text if swapped else good,
                'b':good if swapped else bad_text,'correctWinner':'B' if swapped else 'A',
                'goldOrigin':'controlled semantic mutation, not a human preference rating',
                'category':category,'dialect':'en-GB','profile':'standard',
                'construction':'both-rewritten' if args.rewritten else 'unchanged-good'})
    target=output_path(args.output)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows),'utf-8')
    write(str(target)+'.manifest.json',{'pairs':len(rows),'families':len(TEMPLATES),
      'sha256':digest(rows),'scope':'Controlled harmful mutations; does not represent all semantic errors',
      'construction':'both-rewritten' if args.rewritten else 'unchanged-good'})


if __name__=='__main__':main()
