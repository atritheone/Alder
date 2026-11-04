from pathlib import Path
import copy
import zipfile
import pytest
from lxml import etree
from alder.models import create_project,validate_project,document_text
from alder.document_revisions import review_document,revision_summary,WordRevisionReader
from alder.tracked_moves import validate_moves,W
from alder.publishing import build_export,import_document

STAMP={'id':'move_one','author':'Reviewer','date':'2026-11-03T00:00:00Z','move':True}
def fixture():
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False)
    def text(value,kind=None,strong=False):return {'type':'text','text':value,'marks':([{'type':kind,'attrs':STAMP.copy()}] if kind else [])+([{'type':'strong'}] if strong else [])}
    doc={'type':'doc','content':[
        {'type':'paragraph','content':[text('Alpha ','revision_deletion',True),text('sentence. ','revision_deletion'),text('Beta sentence.')]},
        {'type':'paragraph','content':[text('Gamma sentence. '),text('Alpha ','revision_insertion',True),text('sentence.','revision_insertion')]}
    ]}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':doc}]}
    return validate_project(p)

def block_fixture():
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False)
    def paragraph(text,kind=None):
        attrs={'align':'right','fontSize':14,'spaceAfter':9}
        if kind:attrs.update(blockId='source_ghost' if kind=='deletion' else 'original',revisionMove={'kind':kind,'stamp':STAMP.copy(),'originalId':'original'})
        return {'type':'paragraph','attrs':attrs,'content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}
    doc={'type':'doc','content':[paragraph('Moved paragraph.','deletion'),paragraph('Middle paragraph.'),paragraph('Moved paragraph.','insertion'),paragraph('Final paragraph.')]}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':doc}]}
    return validate_project(p)

def section_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for n in (nodes[0],nodes[2]):n['attrs']['revisionMove'].update(part=0,count=2)
    extra=copy.deepcopy(nodes[0]);extra['content'][0]['text']='Second moved paragraph.';extra['attrs'].update(blockId='second_ghost',revisionMove={**extra['attrs']['revisionMove'],'part':1,'originalId':'second'})
    destination=copy.deepcopy(extra);destination['attrs'].update(blockId='second',revisionMove={**extra['attrs']['revisionMove'],'kind':'insertion'})
    nodes.insert(3,destination);nodes.insert(1,extra)
    return validate_project(p)

def picture_fixture():
    import base64,io
    from PIL import Image
    data=io.BytesIO();Image.new('RGB',(96,48),'#23405e').save(data,format='PNG')
    p=block_fixture();p['assets']=[{'id':'picture_asset','name':'picture.png','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()}];nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        node['content'].extend([{'type':'inline_image','attrs':{'blockId':'picture' if node['attrs']['revisionMove']['kind']=='insertion' else 'picture_ghost','src':'asset:picture_asset','assetId':'picture_asset','alt':'Moved illustration','width':96,'crop':{'left':10,'right':0,'top':0,'bottom':0}}},{'type':'text','text':' After picture.'}])
    return validate_project(p)

def bookmark_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        ghost=node['attrs']['revisionMove']['kind']=='deletion';identifier='passage_ghost' if ghost else 'passage'
        node['content'].insert(0,{'type':'bookmark','attrs':{'blockId':identifier,'name':'Passage','range':True}})
        node['content'].append({'type':'bookmark_end','attrs':{'blockId':'end_ghost' if ghost else 'end','targetId':identifier,'name':'Passage'}})
    nodes[-1]['content'].append({'type':'cross_reference','attrs':{'targetId':'passage'},'content':[{'type':'text','text':'Moved paragraph.'}]})
    return validate_project(p)


@pytest.mark.parametrize('format',['html','epub'])
def test_bookmark_moves_keep_one_live_target_and_references_through_review(tmp_path,format):
    from alder.document_references import reference_values
    p=bookmark_fixture();source=p['book']['chapters'][0]['document'];assert validate_project(p)==p
    exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        nodes=[c for n in actual['content'] for c in n.get('content',[])]
        target=next(n for n in nodes if n['type']=='bookmark');end=next(n for n in nodes if n['type']=='bookmark_end');reference=next(n for n in nodes if n['type']=='cross_reference')
        assert target['attrs']['name']=='Passage'
        assert end['attrs']['targetId']==reference['attrs']['targetId']==target['attrs']['blockId']
        assert reference_values([actual])[reference['attrs']['targetId']]=='Moved paragraph.'


def test_bookmark_moves_refuse_word_export_until_reviewed(tmp_path):
    p=bookmark_fixture()
    with pytest.raises(ValueError,match='moves containing bookmarks'):build_export(p,'docx',tmp_path)
    for view in ('original','final'):
        reviewed=copy.deepcopy(p);reviewed['book']['chapters'][0]['document']=review_document(p['book']['chapters'][0]['document'],view)
        restored=import_document(Path(build_export(reviewed,'docx',tmp_path)['path']))['document']
        from alder.document_references import reference_values
        nodes=[c for n in restored['content'] for c in n.get('content',[])]
        target=next(n for n in nodes if n['type']=='bookmark');reference=next(n for n in nodes if n['type']=='cross_reference')
        assert target['attrs']['name']=='Passage'
        assert reference_values([restored])[reference['attrs']['targetId']]=='Moved paragraph.'


def test_bookmark_move_rejects_partial_ranges_and_migrates_copied_targets():
    p=bookmark_fixture();copied=copy.deepcopy(p['book']['chapters'][0]);copied['id']='copy';p['book']['chapters'].append(copied)
    migrated=validate_project(p);assert validate_project(migrated)==migrated
    ids=[]
    for chapter in migrated['book']['chapters']:
        for view in ('original','final'):
            nodes=[c for n in review_document(chapter['document'],view)['content'] for c in n.get('content',[])]
            target=next(n for n in nodes if n['type']=='bookmark');end=next(n for n in nodes if n['type']=='bookmark_end');reference=next(n for n in nodes if n['type']=='cross_reference')
            assert target['attrs']['name']=='Passage'
            assert end['attrs']['targetId']==reference['attrs']['targetId']==target['attrs']['blockId'];ids.append(target['attrs']['blockId'])
    assert ids[0]==ids[1] and ids[2]==ids[3] and ids[0]!=ids[2]
    broken=bookmark_fixture()
    for node in broken['book']['chapters'][0]['document']['content'][:3]:node['content']=[c for c in node.get('content',[]) if c['type']!='bookmark_end']
    with pytest.raises(ValueError,match='complete bookmarked passage'):validate_project(broken)


def attached_caption_fixture(above=False):
    p=picture_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for index in (2,0):
        picture=nodes[index];move=picture['attrs']['revisionMove'];ghost=move['kind']=='deletion'
        move.update(part=1 if above else 0,count=2)
        caption={'type':'paragraph','attrs':{'blockId':'caption_ghost' if ghost else 'caption','captionLabel':'Figure','captionTargetId':'picture_ghost' if ghost else 'picture','revisionMove':{**copy.deepcopy(move),'originalId':'caption','part':0 if above else 1}},'content':[
            {'type':'text','text':'Figure '},{'type':'sequence','attrs':{'blockId':'number_ghost' if ghost else 'number','sequenceName':'Figure'},'content':[{'type':'text','text':'1'}]}, {'type':'text','text':': Attached caption.','marks':[{'type':'em'}]},
        ]}
        nodes.insert(index if above else index+1,caption)
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
@pytest.mark.parametrize('above',[False,True])
def test_attached_caption_moves_keep_object_anchor_and_both_decisions(tmp_path,format,above):
    p=attached_caption_fixture(above);source=p['book']['chapters'][0]['document']
    exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        caption=next(node for node in actual['content'] if node.get('attrs',{}).get('captionLabel'))
        picture=next(child for node in actual['content'] for child in node.get('content',[]) if child['type']=='inline_image')
        assert caption['attrs']['captionTargetId']==picture['attrs']['blockId']
        picture_index=next(i for i,node in enumerate(actual['content']) if picture in node.get('content',[]))
        assert actual['content'].index(caption)==picture_index+(-1 if above else 1)
        assert any(mark['type']=='em' for mark in caption['content'][-1]['marks'])


def test_attached_caption_move_refuses_a_different_target_on_one_side():
    p=attached_caption_fixture()
    p['book']['chapters'][0]['document']['content'][1]['attrs']['captionTargetId']='unrelated_picture'
    with pytest.raises(ValueError,match='same contents and formatting'):validate_project(p)


def equation_fixture():
    from alder.equations import import_mathml
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    formula=import_mathml('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>')
    for node in (nodes[0],nodes[2]):
        item=copy.deepcopy(formula);item['attrs']['blockId']='formula' if node['attrs']['revisionMove']['kind']=='insertion' else 'formula_ghost'
        node['content'].extend([item,{'type':'text','text':' After formula.'}])
    return validate_project(p)

def form_fixture():
    from alder.form_fields import properties,field_value
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        for kind in ('plain','rich','checkbox','date'):
            identifier='field_'+kind+('_ghost' if node['attrs']['revisionMove']['kind']=='deletion' else '')
            attrs=properties(dict(kind=kind,blockId=identifier,label='Moved '+kind,tag='tag_'+kind,lockContent=True,lockDelete=True,checked=kind=='checkbox',dateValue='2026-11-03' if kind=='date' else ''))
            value=[{'type':'text','text':'VALUE_'+kind}]
            if kind=='rich':value=[{'type':'text','text':'RICH_FIRST','marks':[{'type':'strong'}]},{'type':'hard_break'},{'type':'text','text':'RICH_LAST','marks':[{'type':'em'}]}]
            node['content'].extend([{'type':'text','text':' '},{'type':'form_field','attrs':attrs,'content':field_value(attrs,value)}])
    return validate_project(p)

def text_box_fixture():
    from alder.text_boxes import properties
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        identifier='box' if node['attrs']['revisionMove']['kind']=='insertion' else 'box_ghost'
        node['content'].append({'type':'text_box','attrs':properties({'blockId':identifier,'width':180,'minHeight':60,'fill':'#c9d8e8'}),'content':[{'type':'text','text':'BOX_FIRST','marks':[{'type':'strong'}]},{'type':'hard_break'},{'type':'text','text':'BOX_LAST','marks':[{'type':'em'}]}]})
    return validate_project(p)

BOX_LAYOUT={'measuredTextBoxes':{key:{'width':180,'height':60} for key in ('box','box_ghost')}}

def note_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        for kind in ('footnote','endnote'):
            suffix='_ghost' if node['attrs']['revisionMove']['kind']=='deletion' else ''
            body={'type':'doc','content':[
                {'type':'paragraph','attrs':{'blockId':kind+'_body'+suffix},'content':[{'type':'text','text':'NOTE_'+kind,'marks':[{'type':'strong'}]}]},
                {'type':'ordered_list','attrs':{'order':3},'content':[{'type':'list_item','content':[{'type':'paragraph','content':[{'type':'text','text':'Nested note wording.','marks':[{'type':'em'}]}]}]}]},
            ]}
            node['content'].append({'type':'document_note','attrs':{'blockId':kind+suffix,'kind':kind,'body':body}})
    return validate_project(p)

def field_fixture():
    from alder.document_fields import field_values
    p=block_fixture();p['settings'].update(author='Field author',subject='Field subject');nodes=p['book']['chapters'][0]['document']['content']
    values=field_values(p)
    nodes[1]['attrs']['pageBreakBefore']=True
    for node in (nodes[0],nodes[2]):
        ghost=node['attrs']['revisionMove']['kind']=='deletion'
        for kind,value in [('page','1' if ghost else '2'),('pageCount','2'),*values.items(),('merge','Recipient'),('heading1','Heading context')]:
            attrs={'fieldKind':kind,'blockId':'field_'+kind+('_ghost' if ghost else '')}
            if kind=='merge':attrs['mergeKey']='Recipient'
            node['content'].extend([{'type':'text','text':' '},{'type':'document_field','attrs':attrs,'content':[{'type':'text','text':value}],'marks':[{'type':'strong'}]}])
    nodes.insert(0,{'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':'Heading context'}]})
    return validate_project(p)

def sequence_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in nodes[:3]:
        moved=node.get('attrs',{}).get('revisionMove')
        identifier='first_ghost' if moved and moved['kind']=='deletion' else 'first' if moved else 'second'
        node['attrs']['captionLabel']='Figure'
        node['content'].extend([{'type':'text','text':' Figure '},{'type':'sequence','attrs':{'blockId':identifier,'sequenceName':'Figure'},'marks':[{'type':'strong'}],'content':[{'type':'text','text':'1' if moved else '2'}]}])
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_sequence_moves_count_only_live_captions_and_keep_definitions(tmp_path,format):
    from alder.document_captions import number_captions
    p=sequence_fixture();source=p['book']['chapters'][0]['document'];number_captions([source])
    def sequences(document):return [c for n in document['content'] for c in n.get('content',[]) if c['type']=='sequence']
    assert [document_text(node) for node in sequences(source)]==['2','1','2']
    exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document'];assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=sequences(review_document(restored,view));assert len(actual)==2
        assert all(node['attrs']['sequenceName']=='Figure' and any(mark['type']=='strong' for mark in node['marks']) for node in actual)
        expected=review_document(source,view);number_captions([expected]);after=review_document(restored,view);number_captions([after])
        assert document_text(after)==document_text(expected)


def citation_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    source={'id':'source_one','type':'book','title':'Moved source','author':[{'family':'Smith','given':'Alex'}],'issued':{'date-parts':[[2020]]},'publisher':'Example Press'}
    for node in (nodes[0],nodes[2]):
        node['content'].append({'type':'citation','attrs':{'blockId':'cite_ghost' if node['attrs']['revisionMove']['kind']=='deletion' else 'cite','items':[{'source':source,'locator':'12','label':'page'}],'renderedStyle':'apa'},'content':[{'type':'text','text':'(Smith, 2020, p. 12)'}]})
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_citation_paragraph_moves_keep_source_metadata_and_both_review_outcomes(tmp_path,format):
    p=citation_fixture();source=p['book']['chapters'][0]['document'];exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        document=review_document(restored,view);citations=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='citation'];assert len(citations)==1
        expected=next(c for n in review_document(source,view)['content'] for c in n.get('content',[]) if c['type']=='citation')
        assert citations[0]['attrs']['items']==expected['attrs']['items']
        assert citations[0]['attrs']['renderedStyle']=='apa'
        assert document_text(document)==document_text(review_document(source,view))


@pytest.mark.parametrize('mutation',['missing_metadata','unknown_content'])
def test_moved_citations_refuse_missing_metadata_or_converted_content(tmp_path,mutation):
    exported=Path(build_export(citation_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for control in root.iter(f'{{{W}}}sdt'):
        if mutation=='missing_metadata':control.find(f'{{{W}}}sdtPr/{{{W}}}tag').set(f'{{{W}}}val','AlderCitation:missing')
        else:etree.SubElement(control.find(f'{{{W}}}sdtContent'),f'{{{W}}}customXml')
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'broken-citation.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError):import_document(changed)


def index_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        for index,attrs in enumerate([
            {'terms':['Trees','Alder'],'sortTerms':['','Alnus'],'indexGroup':'P'},
            {'terms':['Woodland'],'see':'See Trees'},
            {'terms':['Passage'],'rangeId':'passage'},
        ]):
            node['content'].append({'type':'index_entry','attrs':{**attrs,'blockId':'index_'+str(index)+('_ghost' if node['attrs']['revisionMove']['kind']=='deletion' else '')}})
    nodes.insert(0,{'type':'paragraph','content':[{'type':'bookmark','attrs':{'blockId':'passage','name':'Passage','range':True}},{'type':'text','text':'Indexed passage.'},{'type':'bookmark_end','attrs':{'targetId':'passage','name':'Passage'}}]})
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_index_paragraph_moves_keep_one_live_entry_and_both_review_outcomes(tmp_path,format):
    from alder.document_index import entries
    p=index_fixture();source=p['book']['chapters'][0]['document'];assert len(entries([source]))==3
    exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document']
    p['book']['chapters'][0]['document']=restored;restored=validate_project(p)['book']['chapters'][0]['document']
    assert len(revision_summary(restored))==1 and len(entries([restored]))==3
    for view in ('original','final'):
        document=review_document(restored,view);actual=entries([document]);assert len(actual)==3
        assert document_text(document)==document_text(review_document(source,view))
        assert actual[0]['terms']==['Trees','Alder'] and actual[0]['sortTerms']==['','Alnus'] and actual[0]['indexGroup']=='P'
        assert actual[1]['see']=='See Trees'
        bookmark=next(c for n in document['content'] for c in n.get('content',[]) if c['type']=='bookmark')
        assert actual[2]['rangeId']==bookmark['attrs']['blockId']


def reference_fixture():
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        for index,(target,format,value) in enumerate([('target','text','Heading target'),('target','number','1'),('target','page','1'),('passage','text','Passage target'),('note','number','1'),('note','page','1')]):
            attrs={'blockId':'reference_'+str(index)+('_ghost' if node['attrs']['revisionMove']['kind']=='deletion' else ''),'targetId':target,'referenceFormat':format}
            node['content'].extend([{'type':'text','text':' '},{'type':'cross_reference','attrs':attrs,'content':[{'type':'text','text':value}],'marks':[{'type':'strong'}]}])
    nodes[:0]=[
        {'type':'heading','attrs':{'blockId':'target','level':1,'headingNumbered':True},'content':[{'type':'text','text':'Heading target'}]},
        {'type':'paragraph','content':[{'type':'bookmark','attrs':{'blockId':'passage','name':'Passage','range':True}},{'type':'text','text':'Passage target'},{'type':'bookmark_end','attrs':{'targetId':'passage','name':'Passage'}}]},
        {'type':'paragraph','content':[{'type':'text','text':'Note anchor.'},{'type':'document_note','attrs':{'blockId':'note','kind':'footnote','body':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Note body.'}]}]}}}]},
    ]
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_reference_paragraph_moves_retain_live_targets_and_formatting(tmp_path,format):
    from alder.document_references import reference_values
    p=reference_fixture();exported=Path(build_export(p,format,tmp_path)['path']);restored=import_document(exported)['document']
    p['book']['chapters'][0]['document']=restored;restored=validate_project(p)['book']['chapters'][0]['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        document=review_document(restored,view);values=reference_values([document])
        refs=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='cross_reference'];assert len(refs)==6
        assert [r['attrs'].get('referenceFormat','text') for r in refs]==['text','number','page','text','number','page']
        assert values[refs[0]['attrs']['targetId']]=='Heading target'
        assert values[(refs[1]['attrs']['targetId'],'number')]=='1'
        assert refs[2]['attrs']['targetId']==refs[0]['attrs']['targetId']
        assert values[refs[3]['attrs']['targetId']]=='Passage target'
        assert values[(refs[4]['attrs']['targetId'],'number')]=='1'
        assert refs[5]['attrs']['targetId']==refs[4]['attrs']['targetId']
        assert all(any(m['type']=='strong' for m in ref['marks']) for ref in refs)

def test_unresolved_moved_reference_refuses_word_export_without_flattening(tmp_path):
    p=reference_fixture()
    for paragraph in p['book']['chapters'][0]['document']['content']:
        for node in paragraph.get('content',[]):
            if node['type']=='cross_reference':node['attrs']['targetId']='missing'
    with pytest.raises(ValueError,match='cross-reference.*tracked paragraph'):build_export(p,'docx',tmp_path)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_field_paragraph_moves_retain_instructions_and_different_cached_page_results(tmp_path,format):
    source=field_fixture();doc=source['book']['chapters'][0]['document']
    exported=build_export(source,format,tmp_path);restored=import_document(Path(exported['path']))['document']
    assert len(revision_summary(restored))==1
    def fields(document):return [c for p in document['content'] for c in p.get('content',[]) if c['type']=='document_field']
    for view in ('original','final'):
        expected=fields(review_document(doc,view));actual=fields(review_document(restored,view))
        assert len(actual)==len(expected)
        for a,b in zip(expected,actual):
            assert a['attrs']['fieldKind']==b['attrs']['fieldKind']
            assert a['attrs'].get('mergeKey')==b['attrs'].get('mergeKey')
            assert any(m['type']=='strong' for m in b['marks'])
        if format!='docx':assert document_text(actual[0])==('1' if view=='original' else '2')

@pytest.mark.parametrize('mutation',['unknown','partial','nested','object'])
def test_moved_fields_refuse_unknown_instructions_or_incomplete_results(tmp_path,mutation):
    exported=Path(build_export(field_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for wrapper in root.iter(f'{{{W}}}moveFrom'):
        if not len(wrapper):continue
        if mutation=='unknown':
            for instruction in wrapper.iter(f'{{{W}}}instrText'):instruction.text=' UNKNOWN_FIELD '
        elif mutation=='partial':
            end=next(n for n in wrapper.iter(f'{{{W}}}fldChar') if n.get(f'{{{W}}}fldCharType')=='end');end.getparent().remove(end)
        else:
            field=etree.SubElement(wrapper,f'{{{W}}}fldSimple',{f'{{{W}}}instr':' PAGE '})
            etree.SubElement(field,f'{{{W}}}'+('fldSimple' if mutation=='nested' else 'object'))
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'unsupported-field.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError):import_document(changed)

@pytest.mark.parametrize('mutation',['none','author','direction','loose','boundary'])
def test_word_updated_field_values_only_rejoin_the_same_complete_move(tmp_path,mutation):
    exported=Path(build_export(field_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for wrapper in list(root.iter(f'{{{W}}}moveTo')):
        if not len(wrapper):continue
        separated=next(r for r in wrapper if r.find(f'{{{W}}}fldChar') is not None and r.find(f'{{{W}}}fldChar').get(f'{{{W}}}fldCharType')=='separate')
        value=separated.getnext();after=list(wrapper)[list(wrapper).index(value)+1:]
        reopened=etree.Element(wrapper.tag,attrib=dict(wrapper.attrib));wrapper.addnext(reopened);wrapper.addnext(value)
        for child in after:reopened.append(child)
        if mutation=='author':reopened.set(f'{{{W}}}author','Another reviewer')
        elif mutation=='direction':reopened.tag=f'{{{W}}}moveFrom'
        elif mutation=='loose':
            extra=etree.SubElement(wrapper.getparent(),f'{{{W}}}r');etree.SubElement(extra,f'{{{W}}}t').text='Untracked wording.'
        elif mutation=='boundary':
            end=reopened.find(f'{{{W}}}r/{"{"+W+"}"}fldChar');end.set(f'{{{W}}}fldCharType','begin')
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'updated-field.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    if mutation!='none':
        with pytest.raises(ValueError):import_document(changed)
    else:
        restored=import_document(changed)['document'];assert len(revision_summary(restored))==1
        assert sum(c['type']=='document_field' for n in review_document(restored,'final')['content'] for c in n.get('content',[]))==8

@pytest.mark.parametrize('mutation',['none','text','author','outside','nested'])
def test_word_reference_update_empty_runs_do_not_hide_authored_revisions(tmp_path,mutation):
    exported=Path(build_export(reference_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for kind in ('moveFrom','moveTo'):
        wrapper=next(n for n in root.iter(f'{{{W}}}{kind}') if len(n))
        split=next(r for r in wrapper if r.find(f'{{{W}}}fldChar') is not None and r.find(f'{{{W}}}fldChar').get(f'{{{W}}}fldCharType')=='separate')
        reopened=etree.Element(wrapper.tag,attrib=dict(wrapper.attrib));wrapper.addnext(reopened)
        for child in list(wrapper)[list(wrapper).index(split):]:reopened.append(child)
        empty=etree.Element(f'{{{W}}}r');props=etree.SubElement(empty,f'{{{W}}}rPr');etree.SubElement(props,f'{{{W}}}b')
        if kind=='moveFrom':
            deletion=etree.Element(f'{{{W}}}del',attrib=dict(wrapper.attrib));deletion.append(empty);wrapper.addnext(deletion)
            if mutation=='text':etree.SubElement(empty,f'{{{W}}}delText').text='Authored deletion.'
            elif mutation=='author':deletion.set(f'{{{W}}}author','Another reviewer')
            elif mutation=='outside':wrapper.addprevious(deletion)
            elif mutation=='nested':etree.SubElement(props,f'{{{W}}}rPrChange')
        else:wrapper.addnext(empty)
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'updated-reference.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    if mutation!='none':
        with pytest.raises(ValueError):import_document(changed)
    else:
        restored=import_document(changed)['document'];assert len(revision_summary(restored))==1
        assert sum(c['type']=='cross_reference' for n in review_document(restored,'final')['content'] for c in n.get('content',[]))==6


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_note_paragraph_moves_retain_bodies_numbering_and_review_outcomes(tmp_path,format):
    from alder.document_notes import notes,number_notes
    source=note_fixture();doc=source['book']['chapters'][0]['document']
    assert len(notes([doc]))==2
    numbered=copy.deepcopy(doc);number_notes([numbered]);assert [n['attrs']['_noteLabel'] for n in notes([numbered])]==['1','i']
    exported=build_export(source,format,tmp_path);restored=import_document(Path(exported['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        expected=review_document(doc,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        before,after=notes([expected]),notes([actual]);assert len(after)==2
        for a,b in zip(before,after):
            assert a['attrs']['kind']==b['attrs']['kind']
            assert document_text(a['attrs']['body'])==document_text(b['attrs']['body'])
            assert any(m['type']=='strong' for m in b['attrs']['body']['content'][0]['content'][0]['marks'])
            assert b['attrs']['body']['content'][1]['type']=='ordered_list'
            assert b['attrs']['body']['content'][1]['attrs']['order']==3
    # Review restores all nested authored identities, not the deletion copy's.
    a,b=[notes([review_document(doc,view)]) for view in ('original','final')]
    assert [n['attrs'] for n in a]==[n['attrs'] for n in b]
    copied=copy.deepcopy(source);chapter=copy.deepcopy(copied['book']['chapters'][0]);chapter['id']='copy';copied['book']['chapters'].append(chapter)
    migrated=validate_project(copied);assert validate_project(migrated)==migrated

@pytest.mark.parametrize('mutation',['missing','custom','unknown','revision','object'])
def test_moved_notes_refuse_lossy_or_missing_bodies(tmp_path,mutation):
    exported=Path(build_export(note_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    if mutation in ('missing','custom'):
        for ref in root.iter(f'{{{W}}}footnoteReference'):ref.set(f'{{{W}}}'+('id' if mutation=='missing' else 'customMarkFollows'),'999' if mutation=='missing' else '1')
        parts['word/document.xml']=etree.tostring(root)
    else:
        root=etree.fromstring(parts['word/footnotes.xml'])
        for note in root:
            if note.get(f'{{{W}}}type','normal')!='normal':continue
            paragraph=next(note.iter(f'{{{W}}}p'))
            if mutation=='unknown':etree.SubElement(paragraph,f'{{{W}}}fldSimple',{f'{{{W}}}instr':' UNKNOWN_FIELD '})
            elif mutation=='object':etree.SubElement(etree.SubElement(paragraph,f'{{{W}}}r'),f'{{{W}}}object')
            else:
                revision=etree.SubElement(paragraph,f'{{{W}}}ins',{f'{{{W}}}id':'99',f'{{{W}}}author':'Another reviewer'})
                etree.SubElement(etree.SubElement(revision,f'{{{W}}}r'),f'{{{W}}}t').text='Added.'
        parts['word/footnotes.xml']=etree.tostring(root)
    changed=tmp_path/'unsupported-note.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError):import_document(changed)

def test_paragraph_move_refuses_revisions_inside_a_text_box_value():
    from alder.tracked_block_moves import validate_block_moves
    doc=text_box_fixture()['book']['chapters'][0]['document']
    for node in (doc['content'][0],doc['content'][2]):
        box=next(c for c in node['content'] if c['type']=='text_box')
        box['content'][0]['marks'].append({'type':'revision_insertion','attrs':{'id':'nested','author':'Editor','date':''}})
    with pytest.raises(ValueError,match='overlapping revisions'):validate_block_moves(doc)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_text_box_paragraph_moves_retain_geometry_and_formatted_story(tmp_path,format):
    source=text_box_fixture();doc=source['book']['chapters'][0]['document']
    exported=build_export(source,format,tmp_path,BOX_LAYOUT);restored=import_document(Path(exported['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        expected=review_document(doc,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        boxes=[c for n in actual['content'] for c in n.get('content',[]) if c['type']=='text_box'];assert len(boxes)==1
        assert boxes[0]['attrs']['width']==pytest.approx(180) and boxes[0]['attrs']['fill']=='#c9d8e8'
        assert any(m['type']=='strong' for m in boxes[0]['content'][0]['marks'])
        assert any(m['type']=='em' for m in boxes[0]['content'][-1]['marks'])
        assert next(c for n in expected['content'] for c in n.get('content',[]) if c['type']=='text_box')['attrs']['blockId']=='box'

@pytest.mark.parametrize('mutation',['rotate','object','paragraph','revision'])
def test_moved_text_box_refuses_conversion_and_overlapping_revisions(tmp_path,mutation):
    exported=Path(build_export(text_box_fixture(),'docx',tmp_path,BOX_LAYOUT)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml']);a='http://schemas.openxmlformats.org/drawingml/2006/main'
    for wrapper in root.iter(f'{{{W}}}moveFrom'):
        for drawing in wrapper.iter(f'{{{W}}}drawing'):
            body=next(drawing.iter(f'{{{W}}}txbxContent'))
            if mutation=='rotate':next(drawing.iter(f'{{{a}}}xfrm')).set('rot','5400000')
            elif mutation=='object':etree.SubElement(body[0],f'{{{W}}}sdt')
            elif mutation=='paragraph':etree.SubElement(body,f'{{{W}}}p')
            else:etree.SubElement(body[0],f'{{{W}}}ins')
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'unsupported-box.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError,match='tracked paragraph move|unsupported structure|unsupported form control'):import_document(changed)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_form_paragraph_moves_retain_values_restrictions_and_review_outcomes(tmp_path,format):
    def fields(node):return ([node] if node['type']=='form_field' else [])+[field for child in node.get('content',[]) for field in fields(child)]
    source=form_fixture();doc=source['book']['chapters'][0]['document']
    exported=build_export(source,format,tmp_path);restored=import_document(Path(exported['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        expected=review_document(doc,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        before,after=fields(expected),fields(actual)
        assert len(after)==4
        for a,b in zip(before,after):
            for key in ('kind','label','tag','lockContent','lockDelete','checked','dateValue'):assert a['attrs'][key]==b['attrs'][key]
            assert document_text(a)==document_text(b)
        assert any(m['type']=='strong' for m in after[1]['content'][0]['marks'])
        assert any(m['type']=='em' for m in after[1]['content'][-1]['marks'])
        assert [n['attrs']['blockId'] for n in before]==['field_'+kind for kind in ('plain','rich','checkbox','date')]

@pytest.mark.parametrize('mutation',['binding','nested','unknown','checkbox','date'])
def test_native_moved_controls_refuse_lossy_conversion(tmp_path,mutation):
    from alder.form_fields import W14
    exported=Path(build_export(form_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for wrapper in root.iter(f'{{{W}}}moveFrom'):
        for control in wrapper.iter(f'{{{W}}}sdt'):
            pr=control.find(f'{{{W}}}sdtPr');body=control.find(f'{{{W}}}sdtContent')
            if mutation in ('binding','unknown'):etree.SubElement(pr,f'{{{W}}}'+('dataBinding' if mutation=='binding' else 'comboBox'))
            elif mutation=='nested':etree.SubElement(body,f'{{{W}}}sdt')
            elif mutation=='checkbox':
                for check in pr.iter(f'{{{W14}}}checkedState'):check.set(f'{{{W14}}}val','2713')
            elif mutation=='date':
                for fmt in pr.iter(f'{{{W}}}dateFormat'):fmt.set(f'{{{W}}}val','dd/MM/yyyy')
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'unsupported.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError,match='unsupported form control'):import_document(changed)

@pytest.mark.parametrize('mutation',['none','author','direction','partial'])
def test_word_relocated_control_move_requires_complete_matching_value(tmp_path,mutation):
    exported=Path(build_export(form_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for wrapper in list(root.iter(f'{{{W}}}moveFrom'))+list(root.iter(f'{{{W}}}moveTo')):
        if not len(wrapper):continue
        paragraph=wrapper.getparent()
        for control in list(wrapper.findall(f'{{{W}}}sdt')):
            # Split the containing wrapper around each moved control, as Word
            # does when resaving a paragraph that contains inline SDTs.
            before=etree.Element(wrapper.tag,attrib=dict(wrapper.attrib))
            while len(wrapper) and wrapper[0] is not control:before.append(wrapper[0])
            wrapper.addprevious(before);wrapper.addprevious(control)
            body=control.find(f'{{{W}}}sdtContent')
            internal=etree.Element(wrapper.tag,attrib=dict(wrapper.attrib))
            for child in list(body):internal.append(child)
            body.append(internal)
            if mutation=='author':internal.set(f'{{{W}}}author','Different reviewer')
            elif mutation=='direction':internal.tag=f'{{{W}}}'+('moveTo' if wrapper.tag.endswith('moveFrom') else 'moveFrom')
            elif mutation=='partial':etree.SubElement(body,f'{{{W}}}r')
        if not len(wrapper):paragraph.remove(wrapper)
    parts['word/document.xml']=etree.tostring(root);changed=tmp_path/'relocated.docx'
    with zipfile.ZipFile(changed,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    if mutation!='none':
        with pytest.raises(ValueError,match='unsupported structure'):import_document(changed)
    else:
        restored=import_document(changed)['document']
        assert len(revision_summary(restored))==1
        for view in ('original','final'):
            assert document_text(review_document(restored,view))==document_text(review_document(form_fixture()['book']['chapters'][0]['document'],view))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_equation_paragraph_move_keeps_editable_formula_and_review_outcomes(tmp_path,format):
    p=equation_fixture();source=p['book']['chapters'][0]['document']
    exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        before=review_document(source,view);after=review_document(restored,view)
        assert document_text(after)==document_text(before)
        formulas=[c for n in after['content'] for c in n.get('content',[]) if c['type']=='equation'];assert len(formulas)==1
        from alder.equations import parse,MML
        assert len(list(parse(formulas[0]['attrs']['mathML']).iter('{'+MML+'}mfrac')))==1
        assert next(c for n in before['content'] for c in n.get('content',[]) if c['type']=='equation')['attrs']['blockId']=='formula'

@pytest.mark.parametrize('foreign_author',[False,True])
def test_word_reopened_move_wrapper_after_equation_needs_same_authorship(tmp_path,foreign_author):
    source=equation_fixture();exported=Path(build_export(source,'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml'])
    for wrapper in list(root.iter(f'{{{W}}}moveFrom'))+list(root.iter(f'{{{W}}}moveTo')):
        if not len(wrapper):continue
        children=list(wrapper);math=next(i for i,n in enumerate(children) if n.tag.endswith('}oMath'))
        nested=etree.SubElement(wrapper,wrapper.tag,attrib=dict(wrapper.attrib));nested.set(f'{{{W}}}id','1000')
        if foreign_author:nested.set(f'{{{W}}}author','Different reviewer')
        for child in children[math+1:]:nested.append(child)
    parts['word/document.xml']=etree.tostring(root);path=tmp_path/'nested.docx'
    with zipfile.ZipFile(path,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    if foreign_author:
        with pytest.raises(ValueError,match='unsupported structure'):import_document(path)
    else:
        restored=import_document(path)['document'];validate_moves(restored)
        for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source['book']['chapters'][0]['document'],view))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_picture_paragraph_moves_preserve_both_views_and_picture_properties(tmp_path,format):
    p=picture_fixture();source=p['book']['chapters'][0]['document']
    export=build_export(p,format,tmp_path);restored=import_document(Path(export['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        before=review_document(source,view);after=review_document(restored,view)
        assert document_text(after)==document_text(before)
        images=[c for n in after['content'] for c in n.get('content',[]) if c['type']=='inline_image'];assert len(images)==1
        assert images[0]['attrs']['alt']=='Moved illustration' and images[0]['attrs']['width']==pytest.approx(96)
        assert images[0]['attrs']['crop']['left']==10
        assert next(c for n in before['content'] for c in n.get('content',[]) if c['type']=='inline_image')['attrs']['blockId']=='picture'
    copy_project=copy.deepcopy(p);chapter=copy.deepcopy(copy_project['book']['chapters'][0]);chapter['id']='copy';copy_project['book']['chapters'].append(chapter)
    migrated=validate_project(copy_project);assert validate_project(migrated)==migrated
    doc=migrated['book']['chapters'][1]['document']
    ids=[]
    for view in ('original','final'):ids.append([c['attrs']['blockId'] for n in review_document(doc,view)['content'] for c in n.get('content',[]) if c['type']=='inline_image'])
    assert ids[0]==ids[1] and ids[0]!=['picture']

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_multi_paragraph_move_is_one_review_group(tmp_path,format):
    source=section_fixture();doc=source['book']['chapters'][0]['document'];export=build_export(source,format,tmp_path)
    restored=import_document(Path(export['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(doc,view))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_whole_paragraph_move_retains_boundaries_and_appearance(tmp_path,format):
    p=block_fixture();source=p['book']['chapters'][0]['document']
    result=build_export(p,format,tmp_path);restored=import_document(Path(result['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1 and revision_summary(restored)[0]['move']
    for view in ('original','final'):
        expected=review_document(source,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        assert len(actual['content'])==3
        assert actual['content'][0]['attrs']['align']=='right'
    assert document_text(source)==document_text(review_document(source,'final'))

def test_paragraph_move_validation_and_cross_chapter_identities():
    p=block_fixture();source=p['book']['chapters'][0]['document'];other=copy.deepcopy(p['book']['chapters'][0]);other['id']='copy';p['book']['chapters'].append(other)
    migrated=validate_project(p);a,b=[revision_summary(c['document'])[0]['id'] for c in migrated['book']['chapters']];assert a!=b
    again=validate_project(migrated);assert again==migrated
    for mutation in ('missing','wording','format','overlap','object'):
        doc=copy.deepcopy(source)
        if mutation=='missing':doc['content'].pop(2)
        elif mutation=='wording':doc['content'][2]['content'][0]['text']='Different.'
        elif mutation=='format':doc['content'][2]['attrs']['align']='left'
        elif mutation=='overlap':doc['content'][2]['content'][0]['marks'].append({'type':'revision_insertion','attrs':STAMP.copy()})
        else:doc['content'][2]['content'].append({'type':'inline_image','attrs':{'src':'x'}})
        with pytest.raises(ValueError):validate_moves(doc)

def test_word_block_move_boundary_relocated_into_paragraph(tmp_path):
    result=build_export(block_fixture(),'docx',tmp_path)
    with zipfile.ZipFile(result['path']) as archive:xml=etree.fromstring(archive.read('word/document.xml'))
    for kind in ('moveFrom','moveTo'):
        start=next(xml.iter(f'{{{W}}}{kind}RangeStart'));paragraph=start.getnext();paragraph.insert(1,start)
    reader=WordRevisionReader(xml);assert len(reader.block_moves)==2

@pytest.mark.parametrize('mutation',['shape','missing_picture'])
def test_word_picture_move_refuses_converted_or_missing_objects(tmp_path,mutation):
    exported=Path(build_export(picture_fixture(),'docx',tmp_path)['path'])
    with zipfile.ZipFile(exported) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml']);a='http://schemas.openxmlformats.org/drawingml/2006/main'
    for drawing in root.iter(f'{{{W}}}drawing'):
        if mutation=='shape':next(drawing.iter(f'{{{a}}}graphicData')).set('uri','unsupported-shape')
        else:next(drawing.iter(f'{{{a}}}blip')).set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed','missing')
    parts['word/document.xml']=etree.tostring(root)
    broken=tmp_path/'broken.docx'
    with zipfile.ZipFile(broken,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    with pytest.raises(ValueError,match='unsupported structure|could not be retained'):import_document(broken)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_paired_move_exchange_retains_both_decisions_and_formatting(tmp_path,format):
    p=fixture();source=p['book']['chapters'][0]['document']
    result=build_export(p,format,tmp_path);doc=import_document(Path(result['path']))['document'];validate_moves(doc)
    summary=revision_summary(doc);assert len(summary)==1 and summary[0]['move']
    for view in ('original','final'):
        assert document_text(review_document(doc,view))==document_text(review_document(source,view))
    if format=='docx':
        with zipfile.ZipFile(result['path']) as archive:xml=etree.fromstring(archive.read('word/document.xml'))
        assert len(list(xml.iter(f'{{{W}}}moveFrom')))==1
        assert len(list(xml.iter(f'{{{W}}}moveTo')))==1
        starts=[n.get(f'{{{W}}}name') for n in xml.iter() if n.tag in (f'{{{W}}}moveFromRangeStart',f'{{{W}}}moveToRangeStart')]
        assert len(starts)==2 and starts[0]==starts[1]

def test_move_validation_rejects_incomplete_split_or_overlapping_content():
    source=fixture()['book']['chapters'][0]['document']
    broken=copy.deepcopy(source);broken['content'].pop()
    with pytest.raises(ValueError,match='missing'):validate_moves(broken)
    broken=copy.deepcopy(source);broken['content'][0]['content'].insert(1,{'type':'text','text':'Unrelated'})
    with pytest.raises(ValueError,match='complete'):validate_moves(broken)
    broken=copy.deepcopy(source);broken['content'][0]['content'][0]['marks'].append({'type':'revision_insertion','attrs':{**STAMP,'id':'other','move':False}})
    with pytest.raises(ValueError,match='overlapping'):validate_moves(broken)

def test_word_move_import_refuses_an_unpaired_range():
    xml=etree.fromstring(f'<w:document xmlns:w="{W}"><w:body><w:p><w:moveFromRangeStart w:id="1" w:name="move"/><w:moveFrom w:id="2"><w:r><w:delText>Moved.</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p></w:body></w:document>')
    with pytest.raises(ValueError,match='incomplete'):WordRevisionReader(xml)


def test_word_bookmark_boundary_normalization_retains_spacing_companion(tmp_path):
    p=fixture();result=build_export(p,'docx',tmp_path)
    with zipfile.ZipFile(result['path']) as archive:xml=etree.fromstring(archive.read('word/document.xml'))
    # Word places the spacing bookmark before the preceding move range end.
    end=next(xml.iter(f'{{{W}}}moveFromRangeEnd'));bookmark=end.getnext()
    end.addprevious(bookmark)
    reader=WordRevisionReader(xml)
    source=next(xml.iter(f'{{{W}}}moveFrom'));space=next(xml.iter(f'{{{W}}}del'))
    assert reader.mark(source)['attrs']==reader.mark(space)['attrs']


def test_move_validation_rejects_changed_wording_and_bad_html_flag(tmp_path):
    p=fixture();p['book']['chapters'][0]['document']['content'][1]['content'][-1]['text']='different.'
    with pytest.raises(ValueError,match='same wording'):validate_project(p)
    path=tmp_path/'broken.html';path.write_text('<p><span data-revision-move="false" data-revision-insertion="id">text</span></p>',encoding='utf-8')
    with pytest.raises(ValueError,match='metadata'):import_document(path)

def test_word_inline_moves_inherit_paragraph_font_and_refuse_different_appearances(tmp_path):
    p=fixture()
    for para in p['book']['chapters'][0]['document']['content']:para.setdefault('attrs',{})['fontSize']=18
    exported=build_export(p,'docx',tmp_path)
    with zipfile.ZipFile(exported['path']) as archive:xml=etree.fromstring(archive.read('word/document.xml'))
    for kind in ('moveFrom','moveTo'):
        wrapper=next(xml.iter(f'{{{W}}}{kind}'))
        assert all(r.find(f'{{{W}}}rPr/{{{W}}}sz').get(f'{{{W}}}val')=='36' for r in wrapper.iter(f'{{{W}}}r'))
    p['book']['chapters'][0]['document']['content'][1]['attrs']['fontSize']=24
    with pytest.raises(ValueError,match='inherited character formatting'):build_export(p,'docx',tmp_path)


def shape_fixture():
    from alder.document_shapes import properties
    p=block_fixture();nodes=p['book']['chapters'][0]['document']['content']
    for node in (nodes[0],nodes[2]):
        identifier='diagram' if node['attrs']['revisionMove']['kind']=='insertion' else 'diagram_ghost'
        node['content'].append({'type':'shape','attrs':properties({'kind':'arrow','alt':'Moved diagram','width':96,'height':48,'fill':'#c9d8e8','blockId':identifier})})
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_shape_moves_keep_geometry_and_review_outcomes(tmp_path,format):
    p=shape_fixture();source=p['book']['chapters'][0]['document']
    exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        before=review_document(source,view);after=review_document(restored,view)
        assert document_text(after)==document_text(before)
        diagrams=[c for n in after['content'] for c in n.get('content',[]) if c['type']=='shape'];assert len(diagrams)==1
        assert diagrams[0]['attrs']['kind']=='arrow' and diagrams[0]['attrs']['width']==pytest.approx(96) and diagrams[0]['attrs']['height']==pytest.approx(48)
        assert diagrams[0]['attrs']['alt']=='Moved diagram' and diagrams[0]['attrs']['fill'].lower()=='#c9d8e8'
        assert next(c for n in before['content'] for c in n.get('content',[]) if c['type']=='shape')['attrs']['blockId']=='diagram'


@pytest.mark.parametrize('supported',[True,False])
def test_native_shape_move_chooses_qualified_drawing_not_legacy_fallback(tmp_path,supported):
    p=shape_fixture();source=Path(build_export(p,'docx',tmp_path)['path'])
    with zipfile.ZipFile(source) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    root=etree.fromstring(parts['word/document.xml']);mc='http://schemas.openxmlformats.org/markup-compatibility/2006';wps='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
    for drawing in list(root.iter(f'{{{W}}}drawing')):
        alternate=etree.Element(f'{{{mc}}}AlternateContent',nsmap={'mc':mc,'wps':wps})
        drawing.addprevious(alternate);choice=etree.SubElement(alternate,f'{{{mc}}}Choice',Requires='wps' if supported else 'unavailable');choice.append(drawing)
        fallback=etree.SubElement(alternate,f'{{{mc}}}Fallback');etree.SubElement(fallback,f'{{{W}}}pict')
    parts['word/document.xml']=etree.tostring(root);path=tmp_path/'fallback.docx'
    with zipfile.ZipFile(path,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    if not supported:
        with pytest.raises(ValueError,match='unsupported structure'):import_document(path)
    else:
        restored=import_document(path)['document'];validate_moves(restored)
        for view in ('original','final'):
            result=review_document(restored,view);assert sum(c['type']=='shape' for n in result['content'] for c in n.get('content',[]))==1
