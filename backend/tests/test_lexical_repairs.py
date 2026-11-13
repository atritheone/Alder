"""Paired lexical repairs must not turn into a general names/modality bypass."""
import pytest
from alder.proofreading.revisions import revision_rejection
from alder.proofreading.lexical_repairs import repaired_names,changes_known_direction


@pytest.mark.parametrize('source,target',[
    ('Lets go',"Let's go."),
    ('Thanks, Ill watch as soon as I can.',"Thanks, I'll watch as soon as I can."),
    ('Ill check the report.',"I'll check the report."),
    ('May be I will change my phne.', 'Maybe I will change my phone.'),
    ('may be i will change my phne and i would like to by the iphone 13',
     'Maybe I will change my phone, and I would like to buy the iPhone 13.'),
    ('There is no much time to spare.',"There isn't much time to spare."),
    ('theres no much time to spare.',"There's not much time to spare."),
    ('There were no many people waiting.','There were not many people waiting.'),
])
def test_opt_in_faithful_repairs(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=True) is None


@pytest.mark.parametrize('source,target',[
    ('Ill watches a film.',"I'll watch a film."),
    ('I told Ill to watch.',"I told I'll to watch."),
    ('Ill watches a film. Thanks, Ill watch it.',"I'll watch a film. Thanks, I'll watch it."),
    ('I may be ready soon.','I am ready soon.'),
    ('She may be ready. I will leave.','She is ready. Maybe I will leave.'),
    ('May be I will leave. She may wait.','Maybe I will leave. She waits.'),
    ('He has no much time. She has money.','He has time. She does not have much money.'),
    ('There was no much time.','There is not much time.'),
    ('There is no much time.','There is much time. They do not have much time.'),
])
def test_no_unrelated_name_or_modality_bypass(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=True) is not None


@pytest.mark.parametrize('source,target,accepted',[
    ('Lets go',"Let's go.",['Lets']),
    ('Ill watch.',"I'll watch.",['Ill']),
    ('May be I will go.','Maybe I will go.',['May']),
])
def test_explicit_vocabulary_remains_protected(source,target,accepted):
    assert revision_rejection(source,target,accepted,lexical_repairs=True) is not None


def test_no_case_global_or_existing_contraction_shortcut():
    assert not repaired_names('Ill watches and I will watch.',"I'll watch and I will watch.")
    assert not repaired_names('Lets go, and let us wait.','Let us go, and let us wait.')
    assert revision_rejection('Lets go',"Let's go.",[])=='protected-name'
    source='Sam lets go of the rope.';target="Sam let's go of the rope."
    assert not repaired_names(source,target)
    # This lexical exception does not assert that the old fact guards detect
    # every bad grammatical substitution; it supplies no bypass for this one.
    assert revision_rejection(source,target,[],lexical_repairs=True)==revision_rejection(source,target,[])


@pytest.mark.parametrize('source,target',[
    ('We are more closed now.','We are more open now.'),
    ('They are less likely to go.','They are less unlikely to go.'),
    ('She is more certain.','She is more uncertain.'),
])
def test_direction_changes_are_rejected_in_candidate(source,target):
    assert changes_known_direction(source,target)
    assert revision_rejection(source,target,[],lexical_repairs=True)=='scalar-direction'
    assert revision_rejection(source,target,[])=='scalar-direction'


def test_equal_opposite_counts_and_faithful_alternatives_not_rejected():
    assert not changes_known_direction('We are more closed and more open.','We are more open and more closed.')
    assert revision_rejection('We are more closed now.','We are closer now.',[],lexical_repairs=True) is None


@pytest.mark.parametrize('source,target',[
    ("I don't have anything else to do.",'I have nothing else to do.'),
    ('She does not have anything left.','She has nothing left.'),
    ("They didn't have anything to send.",'They had nothing to send.'),
    ("I read when I don't have anything else to do.",'I read when I have nothing else to do.'),
    ('I have a Lo of invoices.','I have a lot of invoices.'),
    ("I'd like a Lo of old files.","I'd like a lot of old files."),
])
def test_aligned_negative_possession_and_unique_quantifier(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=True) is None


@pytest.mark.parametrize('source,target',[
    ("I don't have anything left.",'You have nothing left.'),
    ("I didn't have anything left.",'I have nothing left.'),
    ("I don't have anything to send.",'I have nothing to eat.'),
    ("I don't have anything. You have money.",'I have things. You have nothing.'),
    ("I don't have anything else. I have money.",'I have things. I have nothing else.'),
    ("If I don't have anything left, I will wait.",'I have nothing left; I will wait.'),
    ("Only if I don't have anything left, I will wait.",'If I have nothing left, I will wait.'),
    ("When I don't have anything left, I will wait.",'Because I have nothing left, I will wait.'),
    ("I don't have anything left?",'I have nothing left.'),
    ('If there is no much time, we wait.',"There isn't much time; we wait."),
    ('I have a Lo of apples.','I have a lot of oranges.'),
    ('I have a Lo of invoices. Lo checked them.','I have a lot of invoices. Lo checked them.'),
    ('I met Lo. I have a lot of invoices.','I have a lot of invoices.'),
    ('The title is "a Lo of old files".','The title is "a lot of old files".'),
])
def test_equivalence_does_not_cross_subject_tense_scope_or_named_uses(source,target):
    assert revision_rejection(source,target,[],lexical_repairs=True) is not None


def test_quantifier_exception_does_not_override_declared_vocabulary():
    assert revision_rejection('I have a Lo of invoices.','I have a lot of invoices.',['Lo'],lexical_repairs=True) is not None
