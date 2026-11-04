import copy
from pathlib import Path
import pytest
from alder.models import validate_project,document_text
from alder.document_revisions import review_document
from alder.publishing import build_export,import_document
from alder.tracked_block_moves import identity_nodes
from test_tracked_table_moves import fixture as table_fixture
from test_tracked_list_moves import fixed_fixture as list_fixture
from test_tracked_moves import equation_fixture,shape_fixture,picture_fixture,note_fixture,field_fixture,form_fixture,text_box_fixture,reference_fixture,index_fixture,citation_fixture,sequence_fixture,BOX_LAYOUT


def fixture(container,kind):
    project=table_fixture() if container=='table' else list_fixture()
    example_project={'equation':equation_fixture,'shape':shape_fixture,'inline_image':picture_fixture,'document_note':note_fixture,'document_field':field_fixture,'form_field':form_fixture,'text_box':text_box_fixture,'cross_reference':reference_fixture,'index_entry':index_fixture,'citation':citation_fixture,'sequence':sequence_fixture}[kind]()
    project['assets']=copy.deepcopy(example_project.get('assets',[]))
    example=next(n for n in example_project['book']['chapters'][0]['document']['content'] if n.get('attrs',{}).get('revisionMove',{}).get('kind')=='insertion')
    original=next(c for c in example['content'] if c['type']==kind and (kind!='form_field' or c['attrs']['kind']=='rich'))
    if kind=='cross_reference':
        target=next(n for n in example_project['book']['chapters'][0]['document']['content'] if n.get('attrs',{}).get('blockId')=='target')
        project['book']['chapters'][0]['document']['content'].insert(0,copy.deepcopy(target))
    for root in project['book']['chapters'][0]['document']['content']:
        if root['type']!=container or not root.get('attrs',{}).get('revisionMove'):continue
        paragraph=next(n for n in identity_nodes(root) if n['type']=='paragraph')
        obj=copy.deepcopy(original)
        if kind=='document_field':obj['content']=[{'type':'text','text':'1' if root['attrs']['revisionMove']['kind']=='deletion' else '2'}]
        if root['attrs']['revisionMove']['kind']=='deletion':
            obj['attrs']['blockId']+='_ghost'
            if kind=='document_note':
                for child in identity_nodes(obj['attrs']['body']):
                    if child.get('attrs',{}).get('blockId'):child['attrs']['blockId']+='_ghost'
        paragraph.setdefault('content',[]).extend([obj,{'type':'text','text':' After object.'}])
    return validate_project(project)


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('kind',['equation','shape','inline_image','document_note','document_field','form_field','text_box','cross_reference','index_entry','citation','sequence'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_moved_structural_objects_keep_definitions(tmp_path,container,kind,format):
    source=fixture(container,kind);document=source['book']['chapters'][0]['document']
    if kind=='shape' and format=='docx':
        with pytest.raises(ValueError,match='desktop DOCX'):build_export(source,format,tmp_path)
        return # Native shapes use actual desktop measurement in the UI fixture.
    restored=import_document(Path(build_export(source,format,tmp_path,BOX_LAYOUT if kind=='text_box' else None)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(document,view)
        assert document_text(actual)==document_text(expected)
        nodes=[n for n in identity_nodes(actual) if n['type']==kind and (kind!='sequence' or n['attrs']['sequenceName']=='Figure')];assert len(nodes)==1
        if kind=='shape':
            assert nodes[0]['attrs']['kind']=='arrow' and nodes[0]['attrs']['alt']=='Moved diagram'
            assert nodes[0]['attrs']['width']==96 and nodes[0]['attrs']['fill']=='#c9d8e8'
        elif kind=='inline_image':
            assert nodes[0]['attrs']['width']==pytest.approx(96)
            assert nodes[0]['attrs']['alt']=='Moved illustration' and nodes[0]['attrs']['crop']['left']==10
        elif kind=='document_note':
            assert nodes[0]['attrs']['kind']=='footnote'
            assert document_text(nodes[0]['attrs']['body'])=='NOTE_footnote\nNested note wording.'
            assert nodes[0]['attrs']['body']['content'][1]['type']=='ordered_list'
            assert any(m['type']=='strong' for m in nodes[0]['attrs']['body']['content'][0]['content'][0]['marks'])
        elif kind=='document_field':
            assert nodes[0]['attrs']['fieldKind']=='page'
            assert any(m['type']=='strong' for m in nodes[0]['marks'])
        elif kind=='form_field':
            assert nodes[0]['attrs']['kind']=='rich'
            assert nodes[0]['attrs']['lockContent'] and nodes[0]['attrs']['lockDelete']
            assert nodes[0]['attrs']['label']=='Moved rich' and nodes[0]['attrs']['tag']=='tag_rich'
            assert any(m['type']=='strong' for m in nodes[0]['content'][0]['marks'])
            assert any(m['type']=='em' for m in nodes[0]['content'][-1]['marks'])
        elif kind=='text_box':
            assert nodes[0]['attrs']['width']==pytest.approx(180)
            assert nodes[0]['attrs']['fill'].lower()=='#c9d8e8'
            assert any(m['type']=='strong' for m in nodes[0]['content'][0]['marks'])
            assert any(m['type']=='em' for m in nodes[0]['content'][-1]['marks'])
        elif kind=='cross_reference':
            from alder.document_references import reference_values
            assert reference_values([actual])[nodes[0]['attrs']['targetId']]=='Heading target'
            assert any(m['type']=='strong' for m in nodes[0]['marks'])
        elif kind=='index_entry':
            from alder.document_index import entries
            index=entries([actual]);assert len(index)==1
            assert index[0]['terms']==['Trees','Alder'] and index[0]['sortTerms']==['','Alnus'] and index[0]['indexGroup']=='P'
        elif kind=='citation':
            expected_citation=next(n for n in identity_nodes(expected) if n['type']=='citation')
            assert nodes[0]['attrs']['items']==expected_citation['attrs']['items']
        elif kind=='sequence':
            assert nodes[0]['attrs']['sequenceName']=='Figure'
            assert any(m['type']=='strong' for m in nodes[0]['marks'])
        else:
            from alder.equations import parse,MML
            assert len(list(parse(nodes[0]['attrs']['mathML']).iter('{'+MML+'}mfrac')))==1


@pytest.mark.parametrize('container',['table','ordered_list'])
def test_changed_structural_object_cannot_masquerade_as_move(container):
    project=fixture(container,'shape')
    shape=next(n for n in identity_nodes(project['book']['chapters'][0]['document']) if n['type']=='shape')
    shape['attrs']['width']+=10
    with pytest.raises(ValueError,match='same contents'):validate_project(project)


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_structural_endnotes_retain_one_complete_body_after_review(tmp_path,container,format):
    from alder.document_notes import notes
    project=fixture(container,'document_note');source=project['book']['chapters'][0]['document']
    for node in identity_nodes(source):
        if node['type']=='document_note':node['attrs']['kind']='endnote'
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        expected=notes([review_document(source,view)]);actual=notes([review_document(restored,view)])
        assert len(actual)==1 and actual[0]['attrs']['kind']=='endnote'
        assert document_text(actual[0]['attrs']['body'])==document_text(expected[0]['attrs']['body'])


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('kind',['plain','checkbox','date'])
def test_structural_native_controls_keep_type_value_and_locks(tmp_path,container,kind):
    from alder.form_fields import properties,field_value
    project=fixture(container,'form_field');document=project['book']['chapters'][0]['document']
    for node in identity_nodes(document):
        if node['type']!='form_field':continue
        node['attrs']=properties({**node['attrs'],'kind':kind,'checked':True,'dateValue':'2026-11-04' if kind=='date' else ''})
        node['content']=field_value(node['attrs'],[{'type':'text','text':'Plain value'}])
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view)
        assert document_text(actual)==document_text(review_document(document,view))
        controls=[n for n in identity_nodes(actual) if n['type']=='form_field'];assert len(controls)==1
        assert controls[0]['attrs']['kind']==kind and controls[0]['attrs']['lockContent'] and controls[0]['attrs']['lockDelete']


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('kind',['form_field','text_box'])
def test_structural_object_contents_cannot_change_inside_move(container,kind):
    project=fixture(container,kind)
    obj=next(n for n in identity_nodes(project['book']['chapters'][0]['document']) if n['type']==kind)
    obj['content'][0]['text']='Changed wording'
    with pytest.raises(ValueError,match='same contents'):validate_project(project)


@pytest.mark.parametrize('container',['table','ordered_list'])
def test_structural_sequences_only_count_live_occurrences_and_refresh_ghost(container):
    from alder.document_captions import number_captions
    project=fixture(container,'sequence');document=project['book']['chapters'][0]['document']
    document['content'].insert(0,{'type':'paragraph','content':[{'type':'sequence','attrs':{'sequenceName':'Figure','blockId':'preceding'},'content':[{'type':'text','text':'1'}]}]})
    number_captions([document]);validate_project(project)
    assert [document_text(n) for n in identity_nodes(document) if n['type']=='sequence' and n['attrs']['sequenceName']=='Figure']==['1','2','2']


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('kind',['cross_reference','index_entry','citation','sequence'])
def test_structural_generated_definitions_cannot_change_as_if_only_cached_results(container,kind):
    project=fixture(container,kind)
    obj=next(n for n in identity_nodes(project['book']['chapters'][0]['document']) if n['type']==kind)
    if kind=='cross_reference':obj['attrs']['referenceFormat']='number'
    elif kind=='index_entry':obj['attrs']['terms'][0]='Changed'
    elif kind=='citation':obj['attrs']['items'][0]['source']['title']='Changed source'
    else:obj['attrs']['sequenceName']='Table'
    with pytest.raises(ValueError,match='same contents'):validate_project(project)
