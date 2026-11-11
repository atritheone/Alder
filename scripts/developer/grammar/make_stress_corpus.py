"""Authored compositional regression suite: 1300 cases, only 26 independent families.

This is controlled coverage, not 1300 independent editorial judgments. Entire
construction families stay in one partition, and natural-text qualification is
required separately. Never optimize prompts using the sealed test scores.
"""
import argparse
from common import write

NAMES='Ada Alice Amelia Anna Arthur Ava Ben Beth Blake Chloe Clara Daniel David Diana Edward Eleanor Elena Emily Emma Ethan Eva Felix Fiona Frank George Grace Hannah Harry Helen Henry Hugo Ian Isabel Ivan Jack James Jane Julia Kate Laura Lily Lucas Lucy Mark Mary Maya Nina Noah Nora Oliver'.split()
MIXED=[
 ('{name} recieve the report yesterday, and it contain several mispelled words.','{name} received the report yesterday, and it contained several misspelled words.',['received','misspelled'],['recieve','mispelled','it contain']),
 ('Each of the notes that {name} have written contain an error.','Each of the notes that {name} has written contains an error.',['has','contains'],['have','contain']),
 ('Although {name} was tired, but the report were finished by them.','Although {name} was tired, they finished the report.',['report'],['but','report were']),
 ('{name} bought a umbrella and forget to bring it.','{name} bought an umbrella and forgot to bring it.',['an umbrella','forgot'],['a umbrella','forget']),
 ('The reason why {name} left early was due to the fact that the train were late.','{name} left early because the train was late.',['was late'],['train were']),
 ('After reviewing the report, several mistakes was found by {name}.','After reviewing the report, {name} found several mistakes.',['mistakes'],['mistakes was']),
 ('{name} enjoys swimming, to cycle, and to run.','{name} enjoys swimming, cycling, and running.',['cycling','running'],['to cycle','to run']),
 ('{name} has went home becuase the roads was closed.','{name} has gone home because the roads were closed.',['gone','because','were'],['went','becuase','roads was']),
 ('The reports that {name} submitted yesterday was definately incomplete.','The reports that {name} submitted yesterday were definitely incomplete.',['were','definitely'],['definately','was']),
 ('{name} asked whether the parcel had arrived, they could not find the receipt.','{name} asked whether the parcel had arrived. They could not find the receipt.',['parcel','receipt'],[]),
 ('{name} looks forward to hear from the team and recieve their comments.','{name} looks forward to hearing from the team and receiving their comments.',['hearing','receiving'],['to hear','recieve']),
 ('Neither of the options that {name} considered were suitable, and the manager do not agree.','Neither of the options that {name} considered was suitable, and the manager does not agree.',['was suitable','does not'],['manager do'])]
CLEAN=[
 '{name} reviewed the report before lunch.',
 'The committee asked {name} to submit a revised budget.',
 '{name} {organised} the {program} for the {neighbours}.',
 'After the rain stopped, {name} opened the windows.',
 '{name} carefully checked each measurement before publishing the results.',
 'The train arrived on time, and {name} met the visitors at the station.']
SEMANTIC=[
 ('{name} must not pay {amount} dollars before the report are approved.','{name} must not pay {amount} dollars before the report is approved.',['must not','{amount} dollars','before'],['report are']),
 ('{name} sent Sam {amount} dollars, but Sam has not recieve the payment.','{name} sent Sam {amount} dollars, but Sam has not received the payment.',['Sam','{amount} dollars','not'],['recieve']),
 ('If {name} receive {amount} dollars, they may pay 10 dollars to Lee.','If {name} receives {amount} dollars, they may pay 10 dollars to Lee.',['If','{amount} dollars','may','10 dollars','Lee'],['{name} receive'])]
CREATIVE=[
 '“Not today,” {name} said. “Not ever.”',
 'A long road. A cold night. And {name}, still waiting.',
 '“Ain’t no rush,” {name} said.']


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    assert len(NAMES)==50
    families=[]
    for i,row in enumerate(MIXED):families.append(('mixed',i,'development' if i<4 else 'validation' if i<7 else 'test',row))
    for i,row in enumerate(CLEAN):families.append(('clean',i,'development' if i==0 else 'validation' if i==1 else 'test',row))
    for i,row in enumerate(SEMANTIC):families.append(('semantic',i,['development','validation','test'][i],row))
    for i in range(2):families.append(('document',i,['development','test'][i],None))
    for i,row in enumerate(CREATIVE):families.append(('creative',i,['development','validation','test'][i],row))
    cases=[]
    for family_number,(category,index,split,row) in enumerate(families):
        for number,name in enumerate(NAMES):
            dialect=('en-AU','en-GB','en-US')[(family_number*50+number)%3]
            values={'name':name,'amount':str(20+number*7),'organised':'organized' if dialect=='en-US' else 'organised',
                    'program':'programme' if dialect=='en-GB' else 'program','neighbours':'neighbors' if dialect=='en-US' else 'neighbours'}
            case={'id':f'{category}-{index}-{number}','group':f'{category}-{index}',
                  'split':split,'dialect':dialect,'profile':'creative' if category=='creative' else 'standard',
                  'track':'correctness' if category=='mixed' else 'clean' if category in ('clean','creative') else category,
                  'category':category,'origin':'authored-compositional-control','acceptedWords':[name], 'protected':[name]}
            if category in ('mixed','semantic'):
                source,reference,required,forbidden=row
                case.update(source=source.format(**values),reference=reference.format(**values),
                    required=[x.format(**values) for x in required],forbidden=[x.format(**values) for x in forbidden])
            elif category in ('clean','creative'):
                case['source']=row.format(**values);case['reference']=case['source']
                if category=='creative' and index==2:case['acceptedWords']+=['Ain’t']
            else:
                field=f'(Record {number+1})' if index==0 else f'[Source {number+1}]'
                case['source']=f'The report {field} that {name} wrote it contain several errors.'
                case['reference']=f'The report {field} that {name} wrote contains several errors.'
                case['acceptedWords'].append(field);case['protected'].append(field)
                start=len(case['source'][:case['source'].index(field)].encode('utf-16-le'))//2
                case['languageRanges']=[{'start':start,'end':start+len(field),'language':'zxx'}]
                case['required']=['contains'];case['forbidden']=['it contain']
                case['documentVerificationRequired']=True
            cases.append(case)
    write(args.output,{'schemaVersion':1,'rights':{'evaluationAllowed':True,'origin':'Alder-authored compositional fixtures','redistribution':'repository licence'},
      'purpose':__doc__,'independentFamilies':26,'cases':cases})


if __name__=='__main__':main()
