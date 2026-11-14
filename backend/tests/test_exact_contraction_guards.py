"""A contraction exception can admit only the proven local spelling change."""
import pytest
from alder.proofreading.revisions import revision_rejection


@pytest.mark.parametrize('source,target',[
    ('Ill send the files.',"I'll send the files."),
    ('Ill wait',"I'll wait."),
    ('Lets take the train.',"Let's take the train."),
    ('Well, Ill check the report.',"Well, I'll check the report."),
    ('Ill read. Lets go.',"I'll read. Let's go."),
    ('Ill call at 47 minutes.',"I’ll call at 47 minutes."),
    ('Ill wait if they approve.',"I'll wait if they approve."),
])
def test_exact_corrections_remain_available(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=['contractions']) is None


@pytest.mark.parametrize('source,target',[
    ('Ill wait if they approve.',"I'll wait if they reject."),
    ('Ill send the invoice.',"I'll send the receipt."),
    ('Ill send the files.',"I'll send all the files."),
    ('Ill not send the files.',"I'll send the files."),
    ('Ill send the files?',"I'll send the files."),
    ('Ill send the files.',"I'll send the files?"),
    ('Ill send the old files.',"I'll send the files."),
    ('Ill tell you what to do.',"I'll tell you to do what."),
    ('The title is “Sure, Ill wait”.','The title is “Sure, I\'ll wait”.'),
    ('The title is \'Sure, Ill wait\'.','The title is \'Sure, I\'ll wait\'.'),
    ('Ill works here.',"I'll work here."),
    ('Dr. Ill go.',"Dr. I'll go."),
    ('We asked Ill to wait.',"We asked I'll to wait."),
    ('Ill go. Ill works here.',"I'll go. Ill works here."),
])
def test_other_edits_quotes_and_ambiguous_names_do_not_get_the_exception(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=['contractions']) is not None


def test_declared_name_always_wins_even_for_exact_matching_text():
    assert revision_rejection('Ill wait.',"I'll wait.",['Ill'],lexical_repairs=['contractions'])=='accepted-terms'


@pytest.mark.parametrize('source,target,accepted,profile,mode,rules_available,displayed',[
    ('Lets go',"Let's go.",[],'standard','improve',True,True),
    ('Thanks, Ill watch as soon as I can.',"Thanks, I'll watch as soon as I can.",[],'standard','improve',True,True),
    ('Ill wait.',"I'll wait.",['Ill'],'standard','improve',True,False),
    ('Ill wait if they approve.',"I'll wait if they reject.",[],'standard','improve',True,False),
    ('The command is "Thanks, Ill go".','The command is "Thanks, I\'ll go".',[],'standard','improve',True,False),
    ('Dr. Ill go.',"Dr. I'll go.",[],'standard','improve',True,False),
    ('May be I will go.','Maybe I will go.',[],'standard','improve',True,False),
    ('I read a Lo of books.','I read a lot of books.',[],'standard','improve',True,False),
    ('There is no much time.',"There isn't much time.",[],'standard','improve',True,False),
    ("I don't have anything left.",'I have nothing left.',[],'standard','improve',True,False),
    ('Lets go',"Let's go.",[],'creative','improve',True,False),
    ('Lets go',"Let's go.",[],'standard','rephrase',True,False),
    ('Lets go',"Let's go.",[],'standard','improve',False,False),
])
def test_application_enables_only_exact_contractions_after_the_existing_audit(
        tmp_path,monkeypatch,source,target,accepted,profile,mode,rules_available,displayed):
    import time
    from alder.proofreading.service import ProofreadingService
    from alder.proofreading.contracts import u16
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data');calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':rules_available}})
    monkeypatch.setattr(service.rules,'check',lambda *args:[])
    monkeypatch.setattr(service.model,'check',lambda text,config,stop:calls.append((text,config)) or target)
    context='😀 Earlier. '+source+' Later.';offset=u16('😀 Earlier. ')
    try:
        job=service.start({'text':context,'targetId':'exact-contraction','revision':True,'revisionMode':mode,
          'configuration':{'revisionProfile':profile,'acceptedWords':accepted},
          'range':{'start':offset,'end':offset+u16(source)}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed','cancelled'):break
            time.sleep(.01)
        assert job['status']==('completed' if rules_available else 'partial')
        assert bool(job['annotations'])==displayed and len(calls)==1
        assert calls[0][0]==source and not calls[0][1].get('focusedRepair')
        if displayed:
            item=job['annotations'][0]
            assert (item['start'],item['end'],item['replacementText'])==(offset,offset+u16(source),target)
    finally:service.shutdown()


def test_application_does_not_publish_a_contraction_with_unverified_spelling(tmp_path,monkeypatch):
    import time
    from alder.proofreading.service import ProofreadingService
    from alder.proofreading.contracts import diagnostic,u16
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data');calls=[]
    source='Ill wait with mispelled notes.';target="I'll wait with mispelled notes."
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    def rules(text,config):
        start=u16(text[:text.index('mispelled')])
        return [diagnostic(text,start,start+9,'spelling','lt:SPELL','Spelling',['misspelled'],'rules')]
    monkeypatch.setattr(service.rules,'check',rules)
    monkeypatch.setattr(service.model,'check',lambda text,config,stop:calls.append(config) or target)
    try:
        job=service.start({'text':source,'targetId':'contraction-spelling','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed','cancelled'):break
            time.sleep(.01)
        assert job['status']=='partial' and job['annotations']==[]
        assert len(calls)==2 and calls[1]['spellingRepair']
        assert all(not config.get('focusedRepair') for config in calls)
    finally:service.shutdown()
