import copy
import random
import pytest
from alder.models import ValidationError, validate_document


def outcome(document, fast):
    try: return ('valid', validate_document(copy.deepcopy(document), _plain_fast=fast))
    except (ValidationError, ValueError, TypeError, KeyError) as error: return (type(error).__name__, str(error))


def test_plain_and_general_validation_are_equivalent_for_unicode_edits():
    randomizer = random.Random(71)
    alphabet = 'abc \n\t字😀é'
    for attempt in range(200):
        document = {'type':'doc','content':[
            {'type':'paragraph','attrs':{'blockId':f'block_{index}'},'content':[
                {'type':'text','text':''.join(randomizer.choice(alphabet) for _ in range(randomizer.randrange(80)))}]}
            for index in range(randomizer.randrange(1,30))]}
        source = copy.deepcopy(document)
        assert outcome(document, True) == outcome(document, False)
        assert document == source


@pytest.mark.parametrize('node', [
    {'type':'text','text':4}, {'type':'text','text':'ok','content':{}},
    {'type':'text','text':'ok','marks':{}}, {'type':'paragraph','content':[{'type':'unsupported'}]},
    {'type':'paragraph','attrs':{'fontSize':-1}},
    {'type':'text','text':'x','marks':[{'type':'link','attrs':{'href':'javascript:alert(1)'}}]},
    {'type':'paragraph','attrs':{'revisionMove':{'kind':'destination','id':'bad'}}},
    {'type':'paragraph','attrs':{'keepWithNext':'wrong'}},
    {'type':'paragraph','content':[],'marks':[{'type':'unsupported'}]},
    {'type':'paragraph','attrs':{'blockId':'retained'},'content':[{'type':'text','text':'bold','marks':[{'type':'bold'}]}]},
])
def test_invalid_or_formatted_nodes_keep_general_validation(node):
    document = {'type':'doc','content':[node]}
    assert outcome(document, True) == outcome(document, False)


def test_plain_fast_path_preserves_depth_and_node_count_guards():
    document = {'type':'paragraph','content':[]}
    for _ in range(52): document = {'type':'paragraph','content':[document]}
    assert outcome({'type':'doc','content':[document]},True) == outcome({'type':'doc','content':[document]},False)
    shared = {'type':'text','text':'x'}
    document = {'type':'doc','content':[{'type':'paragraph','content':[shared]*250000}]}
    for fast in (True, False):
        with pytest.raises(ValidationError,match='large or deeply nested'):
            validate_document(document,_plain_fast=fast)
