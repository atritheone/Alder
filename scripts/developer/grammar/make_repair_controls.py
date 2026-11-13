"""Fresh authored regression families for the same-model repair investigation.

These are controlled invariants, not independent human editorial judgments.
Freeze the output before inference; never tune a candidate on its results.
"""
import argparse
from common import corpus,digest,write


SEMANTIC=[
 ('Miriam may send Omar 47 dollars after the receipts has arrived.',
  'Miriam may send Omar 47 dollars after the receipts have arrived.',
  ['Miriam','Omar','may','47 dollars','after'],['receipts has']),
 ('Omar must not release the files until Miriam have signed the form.',
  'Omar must not release the files until Miriam has signed the form.',
  ['Omar','Miriam','must not','until','files'],['Miriam have']),
 ('Miriam rejected Omar because the invoices was incomplete.',
  'Miriam rejected Omar because the invoices were incomplete.',
  ['Miriam rejected Omar','invoices'],['invoices was']),
 ("Omar rejected Miriam's proposal because it were incomplete.",
  "Omar rejected Miriam's proposal because it was incomplete.",
  ["Omar rejected Miriam's proposal"],['it were']),
 ('Miriam received 47 euros yesterday, but the receipts was missing.',
  'Miriam received 47 euros yesterday, but the receipts were missing.',
  ['Miriam','47 euros','yesterday','receipts'],['receipts was']),
 ('If Omar receives 47 dollars, Miriam might send the parcels that has arrived.',
  'If Omar receives 47 dollars, Miriam might send the parcels that have arrived.',
  ['If Omar receives 47 dollars','Miriam might','parcels'],['parcels that has']),
 ('Miriam did not approve every invoice because several totals was wrong.',
  'Miriam did not approve every invoice because several totals were wrong.',
  ['Miriam did not approve every invoice'],['totals was']),
 ('The results suggest that Omar may be right, although the measurements was uncertain.',
  'The results suggest that Omar may be right, although the measurements were uncertain.',
  ['results suggest','Omar may be right','uncertain'],['measurements was']),
 ('Miriam paid -47 dollars, but the entries was difficult to explain.',
  'Miriam paid -47 dollars, but the entries were difficult to explain.',
  ['Miriam','-47 dollars','entries'],['entries was']),
 ('Omar used to visit on Mondays, but the roads was closed yesterday.',
  'Omar used to visit on Mondays, but the roads were closed yesterday.',
  ['Omar used to visit on Mondays','yesterday'],['roads was']),
 ('The sample could be contaminated, so the results requires another check.',
  'The sample could be contaminated, so the results require another check.',
  ['could be contaminated','results'],['results requires']),
 ('Miriam has not stopped reading the books that Omar have recommended.',
  'Miriam has not stopped reading the books that Omar has recommended.',
  ['Miriam has not stopped reading','books','Omar'],['Omar have']),
]
CLEAN=[
 'Miriam checked the receipts before sending the parcel.',
 'Although the figures look unusual, Omar has verified them twice.',
 'The committee may approve the proposal after the final inspection.',
 'Miriam has not agreed to pay the additional 47 dollars.',
 'If Omar arrives early, Miriam will show him the revised drawings.',
 'The technician checked the {colour} of the {aluminium} sample.',
 'Omar {organised} the {programme} for the local {neighbours}.',
 'Neither the red folder nor the blue folder contains the missing receipt.',
 'Miriam asked whether the measurements had been checked.',
 'The records cover 2018–2021 and include the final inspection.',
]
CREATIVE=[
 '“Not a chance,” Miriam said. “Not tonight.”',
 'Dust on the windowsill. Silence in the hall. Omar, listening.',
 '“Ain’t finished yet,” Omar said.',
]


def build():
    cases=[]
    for dialect in ('en-AU','en-GB','en-US'):
        common={'split':'validation','dialect':dialect,'profile':'standard',
                'acceptedWords':['Miriam','Omar'],'origin':'fresh authored repair control'}
        for index,(source,reference,protected,forbidden) in enumerate(SEMANTIC):
            cases.append({**common,'id':f'repair-semantic-{index}-{dialect}',
                'group':f'repair-semantic-{index}','track':'semantic','source':source,
                'reference':reference,'protected':protected,'forbidden':forbidden})
        values={'colour':'color' if dialect=='en-US' else 'colour',
                'aluminium':'aluminum' if dialect=='en-US' else 'aluminium',
                'organised':'organized' if dialect=='en-US' else 'organised',
                'programme':'programme' if dialect=='en-GB' else 'program',
                'neighbours':'neighbors' if dialect=='en-US' else 'neighbours'}
        for kind,templates in (('clean',CLEAN),('creative',CREATIVE)):
            for index,template in enumerate(templates):
                source=template.format(**values)
                cases.append({**common,'id':f'repair-{kind}-{index}-{dialect}',
                    'group':f'repair-{kind}-{index}','track':'clean',
                    'profile':'creative' if kind=='creative' else 'standard',
                    'source':source,'reference':source,
                    'acceptedWords':['Miriam','Omar','Ain’t'] if kind=='creative' else common['acceptedWords']})
        field='[Budget 47 euros]';source=f'😀 The estimates {field} that Miriam sent was incomplete.'
        start=len(source[:source.index(field)].encode('utf-16-le'))//2
        cases.append({**common,'id':f'repair-field-{dialect}','group':'repair-field',
            'track':'document','source':source,
            'reference':f'😀 The estimates {field} that Miriam sent were incomplete.',
            'protected':[field,'Miriam','estimates'],'forbidden':['estimates was','sent was'],
            'languageRanges':[{'start':start,'end':start+len(field),'language':'zxx'}]})
    return {'schemaVersion':1,'rights':{'evaluationAllowed':True,
            'origin':'Alder-authored controlled regression families','redistribution':'repository licence'},
            'scope':__doc__,'independentFamilies':26,'cases':cases}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True)
    args=parser.parse_args();data=build();write(args.output,data);corpus(args.output)
    write(args.output+'.manifest.json',{'cases':len(data['cases']),
        'independentFamilies':data['independentFamilies'],'corpusSHA256':digest(data),
        'frozenBeforeInference':True,'scope':__doc__})


if __name__=='__main__':main()
