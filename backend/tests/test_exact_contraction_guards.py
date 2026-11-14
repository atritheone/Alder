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
    ('We asked Ill to wait.',"We asked I'll to wait."),
    ('Ill go. Ill works here.',"I'll go. Ill works here."),
])
def test_other_edits_quotes_and_ambiguous_names_do_not_get_the_exception(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=['contractions']) is not None


def test_declared_name_always_wins_even_for_exact_matching_text():
    assert revision_rejection('Ill wait.',"I'll wait.",['Ill'],lexical_repairs=['contractions'])=='accepted-terms'
