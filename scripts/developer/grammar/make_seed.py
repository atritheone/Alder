"""Build an honestly labelled development seed; never manufacture held-out qualification."""
import argparse
from common import ROOT, read, write


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    legacy=read(ROOT/'backend/tests/fixtures/sentence-revisions.json')
    cases=[]
    for track,key in [('clarity','problematic'),('clean','clean')]:
        for number,source in enumerate(legacy[key]):
            cases.append({'id':f'legacy-{key}-{number}','group':f'legacy-{key}-{number}',
                          'split':'development','source':source,'dialect':'en-US' if 'neighbors' in source else 'en-AU',
                          'profile':'standard','track':track})
    mixed=[
      ('The report it contains mispelled words that needs correcting.',['misspelled'],['mispelled','needs']),
      ('She recieve the letters yesterday.',['received'],['recieve']),
      ('The children was waiting outside.',['were'],[' was ']),
      ('He has went to the library.',['gone'],['went']),
      ('They does not understand the instructions.',['do not'],['does']),
      ('The books on the shelf is mine.',['are'],[' is ']),
      ('We discussed about the problem.',['discussed'],['discussed about']),
      ('She is more taller than her sister.',['taller'],['more taller']),
      ('I look forward to hear from you.',['hearing'],['to hear']),
      ('Every student have a copy.',['has'],[' have ']),
      ('He bought a umbrella.',['an umbrella'],['a umbrella']),
      ('The results was definately unexpected.',['were','definitely'],['definately',' was '])]
    for number,(source,required,forbidden) in enumerate(mixed):
        cases.append({'id':f'mixed-{number}','group':f'mixed-{number}','split':'development',
          'source':source,'dialect':'en-GB','profile':'standard','track':'correctness',
          'required':required,'forbidden':forbidden})
    write(args.output,{'schemaVersion':1,'purpose':'Development seed only, not the planned 1300-case held-out corpus',
          'rights':{'evaluationAllowed':True,'origin':'Alder-authored development fixtures','redistribution':'repository licence'},'cases':cases})


if __name__=='__main__':main()
