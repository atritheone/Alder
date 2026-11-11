"""Small fresh-inference probes for the measured validator/completeness fixes."""
import argparse
from common import write


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    examples=[
      ('Im pleased that the reports has arrived.',[],['reports'],['reports has','Im','report']),
      ('I wouldnt say that this is finny.',[],['funny'],['finny']),
      ('EduBot have already recieved the report.',['EduBot'],['EduBot has','received'],['recieved']),
      ('Definately, the reports was late.',[],['Definitely','reports were'],['Definately','reports was']),
      ('Alice must not pay 20 dollars before the report are approved.',['Alice'],['20 dollars','not','before','report is'],['report are','$20']),
      ('Alice paid 20 dollars and Sam paid 30 euros, but the receipts was missing.',['Alice','Sam'],['20 dollars','30 euros','receipts were'],['receipts was','$20','€30']),
      ('The results was definately unexpected.',[],['results were','definitely'],['definately','The result']),
      ('The report (Budget 20 dollars) that Alice wrote it contain several errors.',['Alice','(Budget 20 dollars)'],['contains'],['it contain'])]
    cases=[]
    for index,(source,protected,required,forbidden) in enumerate(examples):
        case={'id':'regression-'+str(index),'group':'regression-'+str(index),'split':'development',
          'source':source,'protected':protected,'required':required,'forbidden':forbidden,
          'acceptedWords':['Alice','Sam'] if 'Alice' in source else [],
          'track':'correctness','profile':'standard','dialect':('en-AU','en-GB','en-US')[index%3]}
        case['caseSensitiveChecks']=False  # A valid restructure can move "definitely" inside the sentence.
        if index==7:
            field='(Budget 20 dollars)';begin=len(source[:source.index(field)].encode('utf-16-le'))//2
            case['languageRanges']=[{'start':begin,'end':begin+len(field),'language':'zxx'}]
        cases.append(case)
    write(args.output,{'schemaVersion':1,'rights':{'evaluationAllowed':True,'origin':'Alder-authored regression controls','redistribution':'repository licence'},
      'scope':__doc__,'cases':cases})


if __name__=='__main__':main()
