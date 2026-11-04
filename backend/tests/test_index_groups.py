import copy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_index import entries,groups,xe_instruction,read_xe,read_index_instruction,validate_entry
from alder.document_contents import refresh_contents
from alder.publishing import build_export,import_document


def fixture():
    p=create_project(template='blank');p['name']='Separate indexes'
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    marks=[]
    for index,(terms,group,sorts) in enumerate([
        (['Ordinary'],None,None),(['Alpha'],'P',['Zeta']),(['Zebra'],'P',['Alpha']),
        (['Trees','Alder'],'S',['','Zebra']),(['Trees','Zebra'],'S',['','Alpha']),
    ]):marks.append({'type':'index_entry','attrs':{'blockId':f'entry{index}','terms':terms,'indexGroup':group,'sortTerms':sorts}})
    blocks=[{'type':'paragraph','content':[{'type':'text','text':'BODY only authored wording.'},*marks]}]
    for group,title,sorting in [(None,'General index',True),('P','People index',True),('S','Subject index',True),('P','Plain people',False)]:
        blocks.extend([{'type':'page_break'},{'type':'table_of_contents','attrs':{'kind':'index','title':title,'depth':3,'indexGroup':group,'useSortText':sorting},'content':[{'type':'paragraph'}]}])
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]}
    return validate_project(p)


def test_groups_sort_each_level_and_keep_cached_formatting_separate():
    p=fixture();doc=p['book']['chapters'][0]['document'];refresh_contents([doc]);indexes=[n for n in doc['content'] if n['type']=='table_of_contents']
    assert [document_text(n) for n in indexes]==['General index\nOrdinary, —','People index\nZebra, —\nAlpha, —','Subject index\nTrees\nZebra, —\nAlder, —','Plain people\nAlpha, —\nZebra, —']
    assert document_text(doc).startswith('BODY only authored wording.')
    indexes[1]['content'][1]['attrs']['fontSize']=17
    refresh_contents([doc]);assert indexes[1]['content'][1]['attrs']['fontSize']==17
    same=[{'blockId':'a','terms':['Same'],'sortTerms':['Z']},{'blockId':'b','terms':['Same'],'sortTerms':['A']}]
    assert [g['ids'] for g in groups(same)]==[['b'],['a']]
    assert groups(same,use_sort_text=False)[0]['ids']==['a','b']


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_separate_indexes_and_sort_keys_exchange(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path);restored=import_document(Path(result['path']))
    found=entries([restored['document']]);assert len(found)==5
    assert [(e['terms'],e.get('indexGroup') or 'I',e.get('sortTerms')) for e in found]==[(e['terms'],e.get('indexGroup') or 'I',e.get('sortTerms')) for e in entries([p['book']['chapters'][0]['document']])]
    indexes=[n for n in restored['document']['content'] if n['type']=='table_of_contents']
    assert [n['attrs'].get('indexGroup') or 'I' for n in indexes]==['I','P','S','P']
    assert [n['attrs'].get('useSortText',True) for n in indexes]==[True,True,True,False]
    assert 'Zebra' in document_text(indexes[1]['content'][1])


def test_native_switches_are_bounded_order_independent_and_preserve_ranges():
    attrs={'terms':['Root','Sub: "quote"'],'sortTerms':['Z','A'],'indexGroup':'S','rangeId':'Range','rangeName':'Range'}
    parsed=read_xe(xe_instruction(attrs),[])['attrs'];assert parsed['rangeId']=='Range' and parsed['indexGroup']=='S' and parsed['sortTerms']==['Z','A']
    parsed=read_xe(' XE "Entry" \\t "See other" \\f "s" \\y "After" ',[])['attrs']
    assert parsed['see']=='See other' and parsed['indexGroup']=='S' and parsed['sortTerms']==['After']
    assert read_index_instruction(' INDEX \\f "Subject" \\y \\c 1 ')=={'indexGroup':'S','useSortText':True}
    assert read_index_instruction(' INDEX ')=={'indexGroup':None,'useSortText':False}
    for bad in [' XE "Entry" \\y "Sort" \\y "Again"',' XE "Entry" \\f ""',' XE "Entry" \\unknown "x"',' XE "Entry" \\r "bad name"']:
        assert read_xe(bad,[]) is None
    for bad in [' INDEX \\f "S" \\f "A"',' INDEX \\c 3',' INDEX \\z 9999',' INDEX \\unknown "x"']:
        assert read_index_instruction(bad) is None
    for attrs in [{'terms':['Entry'],'indexGroup':'Too long'},{'terms':['Entry'],'sortTerms':['one','two']},{'terms':['Entry'],'sortTerms':['line\nbreak']}]:
        with pytest.raises(ValueError):validate_entry(attrs)
