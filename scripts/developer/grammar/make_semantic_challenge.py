"""Fresh semantic constructions beyond the initial eight-family controls.

Both candidates perform the same grammar correction. Categories deliberately
include changes not covered by literal names, numbers and negation counters.
Freeze the emitted file before any scoring. These remain authored controls.
"""
import argparse
import json
from common import output_path,write,digest

TEMPLATES=[
 ('{a} sent the report before the meeting.','{a} sent the report after the meeting.','temporal-order'),
 ('The director told {a} that all the reports were approved.','The director told {a} that some of the reports were approved.','universal-scope'),
 ('The amount {a} paid was less than {n} dollars.','The amount {a} paid was more than {n} dollars.','comparison-direction'),
 ('{a} needs exactly {n} copies of the report.','{a} needs at least {n} copies of the report.','exact-quantity-scope'),
 ('{a} sent the package yesterday.','{a} will send the package tomorrow.','event-tense'),
 ('{a} praised the person who criticised them.','{a} criticised the person who praised them.','nested-roles'),
 ('{a} suspects that the report is inaccurate.','{a} knows that the report is inaccurate.','epistemic-strength'),
 ('{a} did not say that {b} approved the report.','{a} said that {b} did not approve the report.','negation-scope')]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True)
    args=parser.parse_args();names='Alice Beth Clara Diana Emma Fiona Grace Helen Jane Kate Laura Mary Nina Nora Olivia Paula Rose Ruth Sara Tara Uma Vera Wendy Yasmin Zoe'.split()
    rows=[]
    for kind,(source,bad,category) in enumerate(TEMPLATES):
        for number,name in enumerate(names):
            values={'a':name,'b':'Sam','n':str(10+number)}
            original=source.format(**values)+' They has kept a copy.'
            good=source.format(**values)+' They have kept a copy.'
            harmful=bad.format(**values)+' They have kept a copy.'
            swapped=number%2==1
            rows.append({'id':f'challenge-{kind}-{number}','group':'challenge-'+str(kind),
              'split':'validation','source':original,'a':harmful if swapped else good,
              'b':good if swapped else harmful,'correctWinner':'B' if swapped else 'A',
              'category':category,'dialect':'en-GB','profile':'standard',
              'goldOrigin':'controlled semantic mutation, not a human preference rating',
              'construction':'both candidates rewrite source grammar'})
    target=output_path(args.output)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows),'utf-8')
    write(str(target)+'.manifest.json',{'pairs':len(rows),'families':len(TEMPLATES),
      'pairsSHA256':digest(rows),'scope':__doc__})


if __name__=='__main__':main()
