import pytest
from alder.proofreading.invariants import narrowed_collective_terms
from alder.proofreading.revisions import revision_rejection


@pytest.mark.parametrize('adjective',['young','elderly','poor','rich','wealthy','unemployed','disabled','homeless'])
def test_collective_group_cannot_become_one_person(adjective):
    source=f'The {adjective} are still waiting.';target=f'The {adjective} person is still waiting.'
    assert 'the '+adjective in narrowed_collective_terms(source,target)
    assert revision_rejection(source,target,[])=='plurality-scope-or-event-time'


def test_malformed_collective_retains_its_group_meaning_during_other_repairs():
    assert 'the young' in narrowed_collective_terms('The young still working, and the reports was late.',
                                               'The young person is still working, and the reports were late.')


@pytest.mark.parametrize('source,target',[
    ('The young person was waiting.','The young person waited.'),
    ('The poor report was late.','The poor report arrived late.'),
    ('The rich red paint was drying.','The rich red paint dried.'),
    ('The elderly are waiting.','The elderly people are waiting.'),
    ('The young are waiting. A young person has arrived.','The young are waiting, and a young person has arrived.'),
])
def test_adjectives_and_existing_individuals_are_not_misclassified(source,target):
    assert not narrowed_collective_terms(source,target)
