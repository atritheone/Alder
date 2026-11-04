from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.document_revisions import review_document, revision_summary
from alder.document_comparison import compare_documents, canonical
from alder.document_comments import walk
from alder.publishing import build_export, import_document
from test_item_breaks import fixture as boundary_fixture, paragraph, structure, STAMP


def fixture(kind='insertion', container='body', outline=False):
    project = boundary_fixture(comments=True, outline=outline)
    doc = review_document(project['book']['chapters'][0]['document'], 'final')
    listing = doc['content'][0]
    listing.setdefault('attrs', {}).update(blockId='changed_list', revisionBlock={'kind': kind, 'stamp': STAMP, 'originalId': 'changed_list'})
    if container == 'cell':
        doc['content'] = [{'type': 'table', 'content': [{'type': 'table_row', 'content': [{'type': 'table_cell', 'content': [listing]}]}]}]
    elif container == 'nested':
        outer = {'type': 'bullet_list', 'content': [{'type': 'list_item', 'content': [paragraph('Outer'), listing]}]}
        if outline:
            outer.update(type='ordered_list', attrs={'listTemplate': listing['attrs'].pop('listTemplate')})
        doc['content'] = [outer]
    if container != 'only': doc['content'].append(paragraph('Anchor'))
    project['book']['chapters'][0]['document'] = doc
    return validate_project(project)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('container', ['body', 'only', 'nested', 'cell'])
@pytest.mark.parametrize('outline', [False, True])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_whole_list_review_preserves_structure_comments_and_numbering(tmp_path, kind, container, outline, format):
    from test_outline_lists import labels
    project = fixture(kind, container, outline); before = deepcopy(project)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert project == before
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        a, b = review_document(restored, view), review_document(source, view)
        assert structure(a) == structure(b)
        if outline: assert labels(a) == labels(b)
        assert [n['attrs']['edge'] for n in walk(a) if n['type'] == 'comment_anchor'] == [n['attrs']['edge'] for n in walk(b) if n['type'] == 'comment_anchor']


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('container', ['body', 'nested', 'cell'])
def test_comparison_recognises_whole_list_change(kind, container):
    from alder.comparison_comments import extract_comments
    source = fixture(kind, container)['book']['chapters'][0]['document']
    original, final = review_document(source, 'original'), review_document(source, 'final')
    result = compare_documents(original, final, author='Reviewer', date=STAMP['date'])
    assert len(revision_summary(result)) == 1
    for view, expected in [('original', original), ('final', final)]:
        a, _, _ = extract_comments(review_document(result, view), recursive=True)
        b, _, _ = extract_comments(expected, recursive=True)
        assert canonical(a) == canonical(b)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('container', ['only', 'cell'])
def test_native_whole_list_leaves_a_separate_required_ending_mark(tmp_path, kind, container):
    from docx import Document
    from docx.oxml.ns import qn
    project = fixture(kind, container)
    path = Path(build_export(project, 'docx', tmp_path)['path'])
    word = Document(path)
    ending = word.tables[0].cell(0, 0)._tc[-1] if container == 'cell' else word.element.body[-2]
    assert ending.tag == qn('w:p')
    assert ending.find(qn('w:pPr')).find(qn('w:pStyle')).get(qn('w:val')) == 'AlderTableTerminator'
    assert ending.find('.//' + qn('w:ins')) is None and ending.find('.//' + qn('w:del')) is None
    assert structure(import_document(path)['document']) == structure(project['book']['chapters'][0]['document'])


def test_whole_list_retains_dependent_numbering_and_refuses_partial_comments(tmp_path):
    project = fixture('deletion')
    doc = project['book']['chapters'][0]['document']
    tail = deepcopy(doc['content'][0]); tail['attrs'] = {'order': 6, 'continuePrevious': True}
    for n in walk(tail):
        if 'content' in n: n['content'] = [c for c in n['content'] if c['type'] != 'comment_anchor']
    doc['content'].append(tail)
    for format in ('html', 'epub','docx'):
        restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
        for view in ('original', 'final'):
            assert review_document(restored, view)['content'][-1]['attrs']['order'] == review_document(doc, view)['content'][-1]['attrs']['order']
    project = fixture('deletion'); doc = project['book']['chapters'][0]['document']
    ending = next(n for n in walk(doc['content'][0]) if any(c['type'] == 'comment_anchor' and c['attrs']['edge'] == 'end' for c in n.get('content', [])))
    doc['content'][-1]['content'].append(ending['content'].pop())
    with pytest.raises(ValueError, match='comment'):
        validate_project(project)


def continued_fixture(kind='deletion',continuation=False,container='body'):
    project=fixture(kind);doc=project['book']['chapters'][0]['document'];changed=doc['content'][0]
    def listing(text,**attrs):return {'type':'ordered_list','attrs':attrs,'content':[{'type':'list_item','content':[paragraph(text)]}]}
    changed['attrs'].update(order=7,continuePrevious=continuation)
    doc['content']=[listing('Earlier',order=3),paragraph('Before'),changed,paragraph('Anchor'),listing('Later',continuePrevious=True),paragraph('Another gap'),listing('Last',continuePrevious=True)]
    if container=='cell':doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':doc['content']}]}]}]
    elif container=='nested':doc['content']=[{'type':'bullet_list','content':[{'type':'list_item','content':[paragraph('Outer'),*doc['content']]}]}]
    return validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('continuation',[False,True])
@pytest.mark.parametrize('container',['body','nested','cell'])
@pytest.mark.parametrize('compare',[False,True])
def test_native_whole_list_review_keeps_its_two_continuation_chains(tmp_path,kind,continuation,container,compare):
    from test_list_kind_revisions import appearance
    project=continued_fixture(kind,continuation,container);source=project['book']['chapters'][0]['document']
    if compare:
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),author=STAMP['author'],date=STAMP['date'])
        project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        a,b=review_document(restored,view),review_document(source,view)
        assert document_text(a)==document_text(b)
        assert structure(a)==structure(b)
        assert appearance(a)==appearance(b)


def outline_continued_fixture(kind='deletion',restart=False,cell=False,bullet=False):
    from test_outline_lists import fixture as outline_fixture
    project=outline_fixture();doc=project['book']['chapters'][0]['document']
    first,later=doc['content'][0],doc['content'][2]
    if bullet:
        for root in (first,later):
            root['type']='bullet_list';root['attrs']['listTemplate'][0].update(format='square',pattern='▪')
    changed=deepcopy(first);changed['attrs'].update(blockId='changed_outline',order=9 if restart else 3,continuePrevious=not restart,revisionBlock={'kind':kind,'stamp':STAMP,'originalId':'changed_outline'})
    for n in walk(changed):
        if n['type']=='text':n['text']='Changed '+n['text']
        if n is not changed:n.get('attrs',{}).pop('blockId',None)
    from test_tracked_comment_moves import THREAD
    paras=[n for n in walk(changed) if n['type']=='paragraph']
    for paragraph_node,edge in ((paras[0],'start'),(paras[-1],'end')):
        anchor={'type':'comment_anchor','attrs':{'threadId':'changed_outline_comment','edge':edge,'thread':deepcopy(THREAD)}}
        if edge=='start':paragraph_node['content'].insert(0,anchor)
        else:paragraph_node['content'].append(anchor)
    doc['content']=[first,paragraph('Before'),changed,paragraph('Anchor'),later]
    if cell:doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':doc['content']}]}]}]
    return validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('restart',[False,True])
@pytest.mark.parametrize('cell',[False,True])
@pytest.mark.parametrize('compare',[False,True])
@pytest.mark.parametrize('bullet',[False,True])
def test_native_whole_outline_change_preserves_all_continued_levels(tmp_path,kind,restart,cell,compare,bullet):
    from test_outline_revisions import assert_appearance
    project=outline_continued_fixture(kind,restart,cell,bullet);source=project['book']['chapters'][0]['document']
    if compare:
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date'])
        project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        a,b=review_document(restored,view),review_document(source,view)
        assert structure(a)==structure(b)
        assert_appearance(a,b)
