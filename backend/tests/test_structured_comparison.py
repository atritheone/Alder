from copy import deepcopy
from pathlib import Path
import pytest
from alder.document_comparison import compare_documents,canonical
from alder.document_revisions import review_document,revision_summary
from alder.models import validate_project,document_text
from alder.publishing import build_export,import_document
from alder.document_comments import walk
from test_document_comparison import doc,para,compare,commented,project_fixture,DATE,threads

def listing():
    return {'type':'ordered_list','attrs':{'order':3,'listStyle':'upper-alpha'},'content':[
        {'type':'list_item','content':[para('First item'),para('Continuation')]},
        {'type':'list_item','content':[para('Second item'),{'type':'bullet_list','content':[{'type':'list_item','content':[para('Nested item')]}]}]}]}

def table():
    return {'type':'table','content':[{'type':'table_row','content':[
        {'type':'table_cell','content':[para('Left wording'),listing()]},
        {'type':'table_cell','content':[para('Right wording')]}]}]}

@pytest.mark.parametrize('kind',['list','table'])
def test_nested_text_and_paragraph_format_comparison_preserves_structure(kind):
    a=doc(listing() if kind=='list' else table());b=deepcopy(a)
    paragraphs=[n for n in walk(b) if n['type']=='paragraph']
    paragraphs[0]['content'][0]['text']='Changed wording';paragraphs[-1]['attrs']={'align':'right'}
    result=compare(a,b);assert len(revision_summary(result))==2

@pytest.mark.parametrize('kind',['list','table'])
def test_whole_structure_moves_keep_recursive_identities(kind):
    node=listing() if kind=='list' else table()
    a=doc(node,'First anchor','Second anchor');b=doc('First anchor','Second anchor',deepcopy(node))
    result=compare(a,b);assert len(revision_summary(result))==1 and revision_summary(result)[0]['move']
    project=project_fixture('Comparison',[]);project['book']['chapters'][0]['document']=result;validate_project(project)


@pytest.mark.parametrize('duplicate', [False, True])
@pytest.mark.parametrize('edited', [False, True])
def test_cross_cell_list_move_requires_unique_unchanged_content(duplicate, edited):
    a = doc(table())
    cells = a['content'][0]['content'][0]['content']
    if duplicate: cells[0]['content'].extend([para('Unchanged separator'), deepcopy(cells[0]['content'][1])])
    b = deepcopy(a)
    destination = b['content'][0]['content'][0]['content']
    moved = destination[0]['content'].pop(1)
    if edited: moved['content'][0]['content'][0]['content'][0]['text'] = 'Edited first item'
    destination[1]['content'].append(moved)
    result = compare(a, b)
    changes = revision_summary(result)
    assert any(change.get('move') for change in changes) == (not duplicate and not edited)

@pytest.mark.parametrize('direction',['insert','delete'])
def test_whole_table_comparison_retains_both_decisions(direction):
    a,b=doc('Anchor'),doc('Anchor',table())
    if direction=='delete':a,b=b,a
    assert len(revision_summary(compare(a,b)))==1

def inputs():
    a=doc('Anchor',table(),'End');b=deepcopy(a)
    left=a['content'][1]['content'][0]['content'];right=b['content'][1]['content'][0]['content']
    annotation=commented('Left wording');left[0]['content'][0]=annotation
    # One comment spans cells; the changed sentence remains in the same cell.
    left[1]['content'][0]['content'].append(left[0]['content'][0]['content'].pop())
    right[0]['content'][0]=deepcopy(annotation)
    right[0]['content'][0]['content'][1]['text']='Changed left wording'
    right[1]['content'][0]['content'].append(deepcopy(left[1]['content'][0]['content'][-1]))
    right[1]['content'][0]['attrs']={'align':'right'}
    right[0]['content'][1]['content'][0]['content'][0]['content'][0]['text']='Edited first item'
    return a,b

def fixture():
    a,b=inputs()
    result=compare_documents(a,b,'Reviewer',DATE)
    project=project_fixture('Structured comparison',[]);project['book']['chapters'][0]['document']=result
    return validate_project(project)

@pytest.mark.parametrize('kind',['list','table','insert','delete'])
@pytest.mark.parametrize('format',['docx','html','epub'])
def test_structure_moves_and_whole_table_changes_exchange(tmp_path,kind,format):
    node=listing() if kind=='list' else table()
    a,b=(doc(node,'Anchor one','Anchor two'),doc('Anchor one','Anchor two',deepcopy(node))) if kind in ('list','table') else (doc('Anchor'),doc('Anchor',node))
    if kind=='delete':a,b=b,a
    project=project_fixture('Comparison',[]);project['book']['chapters'][0]['document']=compare(a,b);project=validate_project(project)
    source=project['book']['chapters'][0]['document'];restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_cross_cell_comments_and_nested_changes_exchange(tmp_path,format):
    project=fixture();source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(threads(restored))==2
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert actual['content'][1]['content'][0]['content'][1]['content'][0]['attrs'].get('align','left')==('right' if view=='final' else 'left')

def test_complete_column_deletion_preserves_reviews_without_altering_inputs():
    a=doc(table());b=deepcopy(a);b['content'][0]['content'][0]['content'].pop()
    before=deepcopy((a,b))
    result=compare(a,b)
    assert len(revision_summary(result))==1
    assert (a,b)==before

def test_partial_column_deletion_refuses_without_altering_inputs():
    a=doc(table());a['content'][0]['content'].append(deepcopy(a['content'][0]['content'][0]))
    b=deepcopy(a);b['content'][0]['content'][0]['content'].pop()
    before=deepcopy((a,b))
    with pytest.raises(ValueError,match='boundaries'):compare_documents(a,b,'Reviewer',DATE)
    assert (a,b)==before

def test_adjacent_list_and_table_travel_as_one_atomic_move():
    anchors=['Anchor '+str(i) for i in range(4)]
    a,b=doc(listing(),table(),*anchors),doc(*anchors,listing(),table())
    result=compare(a,b)
    assert len(revision_summary(result))==1
    changes=[n['attrs']['revisionMove'] for n in result['content'] if n.get('attrs',{}).get('revisionMove')]
    assert [(c['kind'],c['part'],c['count']) for c in changes]==[('deletion',0,2),('deletion',1,2),('insertion',0,2),('insertion',1,2)]

def test_independent_adjacent_table_move_refuses_unsafe_word_review(tmp_path):
    anchors=['Anchor '+str(i) for i in range(4)]
    source=compare(doc(listing(),table(),*anchors),doc(*anchors,listing(),table()))
    for node in source['content']:
        move=node.get('attrs',{}).get('revisionMove')
        if move:
            move['stamp']={**move['stamp'],'id':move['stamp']['id']+'_'+str(move.pop('part'))};move['count']=1
    project=project_fixture('Comparison',[]);project['book']['chapters'][0]['document']=source;project=validate_project(project)
    with pytest.raises(ValueError,match='independent move'):build_export(project,'docx',tmp_path)
    restored=import_document(Path(build_export(project,'html',tmp_path)['path']))['document']
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))

@pytest.mark.parametrize('authored_between',[False,True])
def test_word_relocated_adjacent_move_boundaries_keep_independent_decisions(tmp_path,authored_between):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    pairs=[boundary_inputs(kind) for kind in ('item-insert','item-delete')]
    old,new=[doc(*[node for pair in pairs for node in pair[side]['content']]) for side in (0,1)]
    source=compare_documents(old,new,'Reviewer',DATE)
    project=project_fixture('Adjacent moves',[]);project['book']['chapters'][0]['document']=source
    path=Path(build_export(validate_project(project),'docx',tmp_path)['path']);word=Document(path)
    moved=0
    for end in list(word.element.iter()):
        if end.tag not in (qn('w:moveFromRangeEnd'),qn('w:moveToRangeEnd')):continue
        start=end.getnext()
        if start is None or start.tag not in (qn('w:moveFromRangeStart'),qn('w:moveToRangeStart')):continue
        paragraph=start.getnext()
        if paragraph is None or paragraph.tag!=qn('w:p'):continue
        paragraph.insert(1,start);paragraph.insert(2,end);moved+=1
        if authored_between:
            run=OxmlElement('w:r');text=OxmlElement('w:t');text.text='Authored boundary';run.append(text);paragraph.insert(2,run)
    assert moved==2;word.save(path)
    if authored_between:
        with pytest.raises(ValueError,match='incomplete|unsupported'):import_document(path)
    else:
        restored=import_document(path)['document'];assert len(revision_summary(restored))==len(revision_summary(source))
        for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))

def boundary_inputs(kind):
    def row(name):return {'type':'table_row','content':[{'type':'table_cell','content':[para(name+' left')]},{'type':'table_cell','content':[para(name+' right')]}]}
    if kind=='combined':
        pairs=[boundary_inputs(k) for k in ('item-move','row-move','row-insert','continuation')]
        return tuple(doc(*[node for pair in pairs for node in pair[side]['content']]) for side in (0,1))
    if kind=='item-move':
        a=doc(listing());b=deepcopy(a);b['content'][0]['content'].reverse()
    elif kind in ('item-insert','item-delete'):
        a=doc(listing());b=deepcopy(a)
        annotation=commented('Added first item')
        second=para('Added second item');second['content'].append(annotation['content'].pop())
        b['content'][0]['content'][1:1]=[{'type':'list_item','content':[annotation]},{'type':'list_item','content':[second]}]
        if kind=='item-delete':a,b=b,a
    elif kind=='continuation':
        a=doc(listing());b=deepcopy(a);b['content'][0]['content'][0]['content'].append(para('Added continuation'))
    else:
        a=doc({'type':'table','content':[row('First'),row('Middle'),row('Third'),row('Last')]});b=deepcopy(a)
        rows=b['content'][0]['content']
        if kind=='row-move':rows.append(rows.pop(1))
        else:
            band=[row('Merged'),{'type':'table_row','content':[{'type':'table_cell','content':[para('Lower right')]}]}]
            band[0]['content'][0]['attrs']={'rowspan':2}
            annotation=commented('Merged left');band[0]['content'][0]['content'][0]=annotation
            band[1]['content'][0]['content'][0]['content'].append(annotation['content'].pop())
            rows[1:1]=band
            if kind=='row-delete':a,b=b,a
    a['content'].insert(0,para('Anchor '+kind));b['content'].insert(0,para('Anchor '+kind))
    return a,b

@pytest.mark.parametrize('kind',['item-move','row-move','row-insert','row-delete','continuation','item-insert','item-delete'])
@pytest.mark.parametrize('format',['docx','html','epub'])
def test_changed_container_boundaries_exchange(tmp_path,kind,format):
    a,b=boundary_inputs(kind);result=compare_documents(a,b,'Reviewer',DATE)
    assert len(revision_summary(result))==1
    for view,source in [('original',a),('final',b)]:
        # Comparison combines comments; each complete changed band retains its
        # anchor only in the view that includes that band.
        assert document_text(review_document(result,view))==document_text(source)
    project=project_fixture('Comparison boundaries',[]);project['book']['chapters'][0]['document']=result;project=validate_project(project)
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(project['book']['chapters'][0]['document'],view)
        assert document_text(actual)==document_text(expected)
        assert len(threads(actual))==len(threads(expected))

def commented_move_inputs(kind):
    if kind in ('row','item'):
        a,b=boundary_inputs('row-move' if kind=='row' else 'item-move')
        # Diff keeps the first item as an anchor and moves the second upward.
        source=a['content'][1]['content'][1]
        target=b['content'][1]['content'][-1 if kind=='row' else 0]
    else:
        source=listing() if kind=='list' else table() if kind=='table' else para('Moved paragraph')
        target=deepcopy(source);a,b=doc(source,'Anchor one','Anchor two'),doc('Anchor one','Anchor two',target)
    for node,message in ((source,'Original comment'),(target,'Revised comment')):
        paragraphs=[n for n in walk(node) if n['type']=='paragraph']
        thread=commented('',message=message)['content'][0]['attrs']['thread']
        for p,edge in ((paragraphs[0],'start'),(paragraphs[-1],'end')):
            p['content'].insert(0 if edge=='start' else len(p['content']),{'type':'comment_anchor','attrs':{'threadId':'shared','edge':edge,'thread':deepcopy(thread)}})
    return a,b

@pytest.mark.parametrize('kind',['paragraph','list','table','row','item'])
@pytest.mark.parametrize('format',['docx','html','epub'])
def test_comparison_moves_keep_complete_comments_on_both_sides(tmp_path,kind,format):
    a,b=commented_move_inputs(kind);result=compare_documents(a,b,'Reviewer',DATE)
    assert len(revision_summary(result))==1 and revision_summary(result)[0]['move']
    project=project_fixture('Commented comparison',[]);project['book']['chapters'][0]['document']=result;project=validate_project(project)
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for pending in (project['book']['chapters'][0]['document'],restored):
        assert len(threads(pending))==4
        for view in ('original','final'):
            actual=review_document(pending,view);anchors=threads(actual)
            assert [a['edge'] for a in anchors]==['start','end']
            assert [e['text'] for e in anchors[0]['thread']['entries']]==['Original comment','Revised comment']
            assert document_text(actual)==document_text(a if view=='original' else b)

def test_partial_comment_move_is_refused_without_losing_the_range():
    a,b=commented_move_inputs('paragraph')
    a['content'][1]['content'].append(a['content'][0]['content'].pop())
    # An explicitly reanchored revised thread can supply a complete new range.
    # A source-only partial moved range cannot be split into two comments.
    b['content'][-1]['content']=[n for n in b['content'][-1]['content'] if n['type']!='comment_anchor']
    before=deepcopy((a,b))
    with pytest.raises(ValueError,match='comment'):compare_documents(a,b,'Reviewer',DATE)
    assert (a,b)==before
