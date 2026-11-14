"""Authored guard contracts, not independent editorial ratings or prevalence data."""
import argparse
from common import write


def cases():
    positives=[
      ('contractions','Ill send the files.',"I'll send the files."),
      ('contractions','Sure, Ill help.',"Sure, I'll help."),
      ('contractions','Lets read the report.',"Let's read the report."),
      ('contractions','Ill wait.',"I'll wait."),
      ('initial-maybe','May be we should wait.','Maybe we should wait.'),
      ('initial-maybe','may be she will call.','Maybe she will call.'),
      ('quantifier','We saved a Lo of old files.','We saved a lot of old files.'),
      ('quantifier','I read a Lo of books.','I read a lot of books.'),
      ('existential-negation','There was no enough space.','There was not enough space.'),
      ('existential-negation','There are no many empty jars.','There are not many empty jars.'),
      ('negative-possession','She does not have anything to lend.','She has nothing to lend.'),
      ('negative-possession',"We didn't have anything left.",'We had nothing left.'),
    ]
    harmful=[
      ('contractions','Ill check the files if they are approved.',"I'll check the files if they are rejected."),
      ('contractions','The command is "Thanks, Ill go".','The command is "Thanks, I\'ll go".'),
      ('initial-maybe','May be I will go if the report is approved.','Maybe I will go if the report is rejected.'),
      ('quantifier','I saved a Lo of old sealed invoices.','I saved a lot of old sealed orders.'),
      ('quantifier','We saved a Lo of old files if they are approved.','We saved a lot of old files if they are rejected.'),
      ('existential-negation','There is no much coffee in the pot. There is much coffee in the cup.',
       'There is much coffee in the pot. There is not much coffee in the cup.'),
      ('existential-negation','There is no much time if the plan is approved.','There is not much time if the plan is rejected.'),
      ('negative-possession',"If the plan is approved, I don't have anything to send.",
       'If the plan is rejected, I have nothing to send.'),
    ]
    result=[]
    for kind,items in (('faithful',positives),('harmful',harmful)):
        for i,(family,source,target) in enumerate(items):
            result.append({'id':kind+'-'+str(i),'family':family,'source':source,'target':target,
                           'acceptedWords':[],'expectedAdmission':kind=='faithful','kind':kind})
    # Explicit user vocabulary always outranks the lexical exception.
    for i,(family,source,target,word) in enumerate([
       ('contractions','Ill wait.',"I'll wait.",'Ill'),
       ('initial-maybe','May be we should wait.','Maybe we should wait.','May'),
       ('quantifier','I read a Lo of books.','I read a lot of books.','Lo')]):
        result.append({'id':'vocabulary-'+str(i),'family':family,'source':source,'target':target,
                       'acceptedWords':[word],'expectedAdmission':False,'kind':'explicit-vocabulary'})
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True)
    args=parser.parse_args();write(args.output,{'scope':__doc__,'cases':cases()})
