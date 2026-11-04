from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.publishing import build_export, import_document
from alder.document_comments import walk
from alder.document_revisions import review_document, revision_summary
from test_outline_lists import fixture as plain_fixture
from test_outline_revisions import continuation_fixture, assert_appearance
from test_item_breaks import paragraph, structure


def fixture(depth=1, review=False, cell=False):
    project = continuation_fixture() if review else plain_fixture()
    doc = project['book']['chapters'][0]['document']
    from test_tracked_comment_moves import THREAD
    paras = [n for n in walk(doc) if n['type'] == 'paragraph']
    for p, edge in ((paras[0], 'start'), (paras[-1], 'end')):
        anchor = {'type': 'comment_anchor', 'attrs': {'threadId': 'nested_outline_comment', 'edge': edge, 'thread': deepcopy(THREAD)}}
        if edge == 'start': p['content'].insert(0, anchor)
        else: p['content'].append(anchor)
    for n in walk(doc):
        if n['type'] == 'paragraph': n.setdefault('attrs', {}).update(leftIndent=5, firstLineIndent=3)
    for index, listing in enumerate([n for n in walk(doc) if n['type'] == 'ordered_list']):
        listing['content'][0]['content'].insert(1, paragraph(f'Continuation {index}', leftIndent=4, firstLineIndent=2))
    for level in range(depth):
        doc['content'] = [{'type': 'bullet_list', 'content': [
            {'type': 'list_item', 'content': [paragraph(f'Outer {level}'), *doc['content'], paragraph(f'After {level}')]},
            {'type': 'list_item', 'content': [paragraph(f'Other {level}')]},
        ]}]
    if cell: doc['content'] = [{'type': 'table', 'content': [{'type': 'table_row', 'content': [{'type': 'table_cell', 'content': doc['content']}]}]}]
    return validate_project(project)


def boundary_fixture(kind='insertion', continued=False, restart=False, cell=False, depth=1):
    from test_tracked_lists import fixture as changed_list, outline_continued_fixture
    project = outline_continued_fixture(kind, restart) if continued else changed_list(kind, outline=True)
    doc = project['book']['chapters'][0]['document']
    for level in range(depth):
        doc['content'] = [{'type':'bullet_list', 'content':[
            {'type':'list_item', 'content':[paragraph(f'Outside before {level}'), *doc['content'], paragraph(f'Outside after {level}')]},
            {'type':'list_item', 'content':[paragraph(f'Outer sibling {level}')]},
        ]}]
    if cell:
        doc['content'] = [{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':doc['content']}]}]}]
    return validate_project(project)


def continuation_change_fixture(continued=True, unmatched=False, cell=False, depth=1):
    from alder.document_comparison import compare_documents
    from test_list_revisions import STAMP
    project=fixture(depth=depth,cell=cell)
    doc=project['book']['chapters'][0]['document']
    roots=[n for n in walk(doc) if n.get('attrs',{}).get('listTemplate')]
    target=roots[0] if unmatched else roots[-1]
    target['attrs'].update(continuePrevious=not continued,order=11)
    project=validate_project(project)
    original=deepcopy(project['book']['chapters'][0]['document'])
    roots=[n for n in walk(project['book']['chapters'][0]['document']) if n.get('attrs',{}).get('listTemplate')]
    target=roots[0] if unmatched else roots[-1]
    target['attrs'].update(continuePrevious=continued,order=11)
    project=validate_project(project)
    final=project['book']['chapters'][0]['document']
    project['book']['chapters'][0]['document']=compare_documents(original,final,STAMP['author'],STAMP['date'])
    return validate_project(project)


def move_fixture(cell=False,depth=1,separate=False,continued=False):
    from test_tracked_list_moves import multiparagraph_fixture
    from test_tracked_comment_moves import THREAD
    project=multiparagraph_fixture(outline=True)
    doc=project['book']['chapters'][0]['document']
    if continued:doc['content'][3]['attrs'].update(continuePrevious=True,order=1)
    doc['content']=[n for n in doc['content'] if n['type']!='heading']
    for root in doc['content']:
        move=root.get('attrs',{}).get('revisionMove')
        if not move:continue
        move.update(count=1,part=0)
        paragraphs=[n for n in walk(root) if n['type']=='paragraph']
        for p,edge in ((paragraphs[0],'start'),(paragraphs[-1],'end')):
            anchor={'type':'comment_anchor','attrs':{'threadId':'nested_move_comment','edge':edge,'thread':deepcopy(THREAD)}}
            p.setdefault('content',[]).insert(0 if edge=='start' else len(p.get('content',[])),anchor)
    destination=doc['content'].pop() if separate else None
    for level in range(depth):
        doc['content']=[{'type':'bullet_list','content':[
            {'type':'list_item','content':[paragraph(f'Outside before {level}'),*doc['content'],paragraph(f'Outside after {level}')]},
            {'type':'list_item','content':[paragraph(f'Outer sibling {level}'),*([destination] if destination is not None and level==0 else [])]},
        ]}]
    if cell:doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':doc['content']}]}]}]
    return validate_project(project)


def conversion_fixture(reverse=False,continued=False,cell=False,depth=1):
    from test_list_conversion_revisions import fixture as convert
    from test_tracked_comment_moves import THREAD
    project=convert(reverse=reverse,continued=continued,formatted=True)
    doc=project['book']['chapters'][0]['document']
    paragraphs=[n for n in walk(doc) if n['type']=='paragraph']
    for p,edge in ((paragraphs[0],'start'),(paragraphs[-1],'end')):
        anchor={'type':'comment_anchor','attrs':{'threadId':'nested_conversion_comment','edge':edge,'thread':deepcopy(THREAD)}}
        p.setdefault('content',[]).insert(0 if edge=='start' else len(p.get('content',[])),anchor)
    for level in range(depth):
        doc['content']=[{'type':'bullet_list','content':[
            {'type':'list_item','content':[paragraph(f'Outside before {level}'),*doc['content'],paragraph(f'Outside after {level}')]},
            {'type':'list_item','content':[paragraph(f'Outer sibling {level}')]},
        ]}]
    if cell:doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':doc['content']}]}]}]
    return validate_project(project)


@pytest.mark.parametrize('reverse',[False,True])
@pytest.mark.parametrize('continued',[False,True])
@pytest.mark.parametrize('cell',[False,True])
@pytest.mark.parametrize('depth',[1,4])
def test_independent_outline_conversion_keeps_both_native_structures(tmp_path,reverse,continued,cell,depth):
    project=conversion_fixture(reverse,continued,cell,depth);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert structure(actual)==structure(expected)
        assert_appearance(actual,expected)
        if not any(n.get('attrs',{}).get('listTemplate') for n in walk(expected)):
            from test_list_revisions import appearances
            assert appearances(actual)==appearances(expected)


@pytest.mark.parametrize('damage',['depth','indent','pattern'])
def test_invalid_independent_ordinary_definition_is_not_flattened(tmp_path,damage):
    from docx import Document
    from docx.oxml.ns import qn
    path=Path(build_export(conversion_fixture(reverse=True),'docx',tmp_path)['path']);word=Document(path)
    name=next(n for n in word.part.numbering_part.element.iter(qn('w:name')) if n.get(qn('w:val'),'').startswith('AlderNestedOrdinary:'))
    if damage=='depth':name.set(qn('w:val'),'AlderNestedOrdinary:9:0')
    else:
        level=name.getparent().find(qn('w:lvl'))
        if damage=='indent':level.find('./'+qn('w:pPr')+'/'+qn('w:ind')).set(qn('w:left'),'2200')
        else:level.find(qn('w:lvlText')).set(qn('w:val'),'%9.')
    word.save(path)
    with pytest.raises(ValueError,match='ordinary Word'):import_document(path)


@pytest.mark.parametrize('reverse',[False,True])
@pytest.mark.parametrize('view',['original','final'])
def test_decided_inner_conversion_reexports_without_indent_drift(tmp_path,reverse,view):
    project=conversion_fixture(reverse,continued=True,cell=True,depth=4)
    source=review_document(project['book']['chapters'][0]['document'],view)
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    project['book']['chapters'][0]['document']=review_document(restored,view)
    for _ in range(2):
        restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
        assert structure(restored)==structure(source)
        assert_appearance(restored,source)
        assert not revision_summary(restored)
        project['book']['chapters'][0]['document']=restored


@pytest.mark.parametrize('cell',[False,True])
@pytest.mark.parametrize('depth',[1,4])
@pytest.mark.parametrize('separate',[False,True])
@pytest.mark.parametrize('continued',[False,True])
def test_independent_outline_move_preserves_nested_structure(tmp_path,cell,depth,separate,continued):
    project=move_fixture(cell,depth,separate,continued);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert structure(actual)==structure(expected)
        assert_appearance(actual,expected)


@pytest.mark.parametrize('cell', [False, True])
@pytest.mark.parametrize('depth', [1, 4])
@pytest.mark.parametrize('continued', [False, True])
def test_comparison_recognises_unique_inner_outline_move_between_parents(tmp_path, cell, depth, continued):
    from alder.document_comparison import compare_documents
    from alder.comparison_comments import extract_comments
    project = move_fixture(cell, depth, separate=True, continued=continued)
    source = project['book']['chapters'][0]['document']
    original, final = [review_document(source, view) for view in ('original', 'final')]
    compared = compare_documents(original, final, 'Reviewer', '2026-11-04T00:00:00Z')
    changes = revision_summary(compared)
    assert len(changes) == 1 and changes[0]['move']
    project['book']['chapters'][0]['document'] = compared
    restored = import_document(Path(build_export(validate_project(project), 'docx', tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        actual, expected = review_document(restored, view), review_document(source, view)
        assert structure(actual) == structure(expected)
        assert_appearance(actual, expected)
        a, b = [list(extract_comments(doc, recursive=True)[1].values()) for doc in (actual, expected)]
        assert [c['edges'] for c in a] == [c['edges'] for c in b]
        thread = lambda c: (c['thread']['resolved'], [{k: v for k, v in entry.items() if k != 'id'} for entry in c['thread']['entries']])
        assert [thread(c) for c in a] == [thread(c) for c in b]


@pytest.mark.parametrize('continued', [False,True])
@pytest.mark.parametrize('unmatched', [False,True])
@pytest.mark.parametrize('cell', [False,True])
def test_native_independent_continuation_change_keeps_both_intents(tmp_path,continued,unmatched,cell):
    project=continuation_change_fixture(continued,unmatched,cell)
    source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert structure(actual)==structure(expected)
        assert_appearance(actual,expected)
        assert [bool(n.get('attrs',{}).get('continuePrevious')) for n in walk(actual) if n.get('attrs',{}).get('listTemplate')] == [bool(n.get('attrs',{}).get('continuePrevious')) for n in walk(expected) if n.get('attrs',{}).get('listTemplate')]


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('continued,restart', [(False, False), (True, False), (True, True)])
@pytest.mark.parametrize('cell', [False, True])
@pytest.mark.parametrize('depth', [1, 4])
def test_independent_outline_boundaries_keep_both_native_views(tmp_path, kind, continued, restart, cell, depth):
    project = boundary_fixture(kind, continued, restart, cell, depth)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, 'docx', tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        actual, expected = review_document(restored, view), review_document(source, view)
        assert structure(actual) == structure(expected)
        assert_appearance(actual, expected)


@pytest.mark.parametrize('depth', [1, 2, 4])
@pytest.mark.parametrize('review', [False, True])
@pytest.mark.parametrize('cell', [False, True])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_nested_outline_keeps_nine_levels_parent_items_and_review(tmp_path, depth, review, cell, format):
    project = fixture(depth, review, cell); before = deepcopy(project)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert project == before
    assert len(revision_summary(restored)) == (1 if review else 0)
    for view in ('original', 'final'):
        actual, expected = review_document(restored, view), review_document(source, view)
        assert structure(actual) == structure(expected)
        assert document_text(actual) == document_text(expected)
        assert_appearance(actual, expected)


@pytest.mark.parametrize('damage', ['unwrap', 'level', 'inset', 'number-inset', 'lock'])
def test_damaged_native_nesting_is_not_flattened(tmp_path, damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path = Path(build_export(fixture(), 'docx', tmp_path)['path']); word = Document(path)
    wrapper = next(e for e in word.element.body.iter(qn('w:sdt')) if e.find(qn('w:sdtPr')).find(qn('w:tag')).get(qn('w:val')).startswith('AlderNestedOutline:'))
    tag = wrapper.find(qn('w:sdtPr')).find(qn('w:tag'))
    if damage == 'unwrap':
        parent = wrapper.getparent(); offset = parent.index(wrapper)
        for i, child in enumerate(list(wrapper.find(qn('w:sdtContent')))): parent.insert(offset+i, child)
        parent.remove(wrapper)
    elif damage in ('level', 'inset'):
        value = tag.get(qn('w:val')).split(':'); value[1 if damage == 'level' else 2] = '8' if damage == 'level' else '500'; tag.set(qn('w:val'), ':'.join(value))
    elif damage == 'number-inset':
        name = next(e for e in word.part.numbering_part.element.iter(qn('w:name')) if e.get(qn('w:val')).startswith('AlderNestedOutline:')); name.set(qn('w:val'), 'AlderNestedOutline:500')
    else:
        lock = OxmlElement('w:lock'); lock.set(qn('w:val'), 'sdtContentLocked'); wrapper.find(qn('w:sdtPr')).append(lock)
    word.save(path)
    with pytest.raises(ValueError, match='outline|numbering boundary'):
        import_document(path)


@pytest.mark.parametrize('inside', [False, True])
def test_native_comment_edges_outside_paragraphs_keep_their_exact_range(tmp_path, inside):
    from docx import Document
    from docx.oxml.ns import qn
    project=fixture(review=True,cell=True);source=project['book']['chapters'][0]['document']
    # This fixture adds a continuation after the original comment endpoint.
    # Make the tested range actually end at the control boundary first.
    last_outline=[n for n in walk(source) if n.get('attrs',{}).get('listTemplate')][-1]
    paragraphs=[n for n in walk(last_outline) if n['type']=='paragraph']
    owner=next(p for p in paragraphs if any(c['type']=='comment_anchor' and c['attrs']['edge']=='end' for c in p.get('content',[])))
    ending=next(c for c in owner['content'] if c['type']=='comment_anchor' and c['attrs']['edge']=='end')
    owner['content'].remove(ending);paragraphs[-1]['content'].append(ending)
    path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    marker=next(word.element.body.iter(qn('w:commentRangeStart')))
    wrapper=next(p for p in marker.iterancestors() if p.tag==qn('w:sdt'))
    if inside:wrapper.find(qn('w:sdtContent')).insert(0,marker)
    else:wrapper.addprevious(marker)
    ending=next(word.element.body.iter(qn('w:commentRangeEnd')))
    wrapper=next(p for p in ending.iterancestors() if p.tag==qn('w:sdt'))
    if inside:wrapper.find(qn('w:sdtContent')).append(ending)
    else:wrapper.addnext(ending)
    word.save(path)
    restored=import_document(path)['document']
    for view in ('original','final'):
        a,b=review_document(restored,view),review_document(source,view)
        assert structure(a)==structure(b)
        from alder.comparison_comments import extract_comments
        assert [t['edges'] for t in extract_comments(a,recursive=True)[1].values()] == [t['edges'] for t in extract_comments(b,recursive=True)[1].values()]


@pytest.mark.parametrize('legacy', [False, True])
def test_native_restart_overrides_the_old_nested_continuation_hint(tmp_path, legacy):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path=Path(build_export(fixture(),'docx',tmp_path)['path']);word=Document(path)
    wrappers=[e for e in word.element.body.iter(qn('w:sdt')) if e.find(qn('w:sdtPr')).find(qn('w:tag')).get(qn('w:val')).startswith('AlderNestedOutline:')]
    content=wrappers[1].find(qn('w:sdtContent'));identity=next(content.iter(qn('w:numId'))).get(qn('w:val'))
    root=word.part.numbering_part.element
    if legacy:
        for name in root.iter(qn('w:name')):
            value=name.get(qn('w:val'),'')
            if value.startswith('AlderNestedOutline:'):name.set(qn('w:val'),':'.join(value.split(':')[:2]))
    source=next(n for n in root.findall(qn('w:num')) if n.get(qn('w:numId'))==identity)
    number=deepcopy(source);new_id=str(max(int(n.get(qn('w:numId'))) for n in root.findall(qn('w:num')))+1);number.set(qn('w:numId'),new_id)
    override=OxmlElement('w:lvlOverride');override.set(qn('w:ilvl'),'0');start=OxmlElement('w:startOverride');start.set(qn('w:val'),'10');override.append(start);number.append(override);root.append(number)
    for native in content.iter(qn('w:numId')):native.set(qn('w:val'),new_id)
    word.save(path);restored=import_document(path)['document']
    lists=[n for n in walk(restored) if n.get('attrs',{}).get('listTemplate')]
    assert lists[1]['attrs']['order']==10
    assert not lists[1]['attrs'].get('continuePrevious')


@pytest.mark.parametrize('native_restart', [False, True])
def test_unmatched_nested_continuation_retains_legacy_intent_and_native_restart(tmp_path,native_restart):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    project=fixture()
    first=next(n for n in walk(project['book']['chapters'][0]['document']) if n.get('attrs',{}).get('listTemplate'))
    first['attrs']['continuePrevious']=True
    path=Path(build_export(validate_project(project),'docx',tmp_path)['path']);word=Document(path)
    root=word.part.numbering_part.element
    if native_restart:
        identity=next(e for e in word.element.body.iter(qn('w:sdtContent'))).find('.//'+qn('w:numId')).get(qn('w:val'))
        number=next(n for n in root.findall(qn('w:num')) if n.get(qn('w:numId'))==identity)
        override=OxmlElement('w:lvlOverride');override.set(qn('w:ilvl'),'0')
        start=OxmlElement('w:startOverride');start.set(qn('w:val'),'10');override.append(start);number.append(override)
    else:
        for name in root.iter(qn('w:name')):
            value=name.get(qn('w:val'),'')
            if value.startswith('AlderNestedOutline:'):name.set(qn('w:val'),':'.join(value.split(':')[:2]))
    word.save(path);restored=import_document(path)['document']
    first=next(n for n in walk(restored) if n.get('attrs',{}).get('listTemplate'))
    assert bool(first['attrs'].get('continuePrevious')) is not native_restart
    if native_restart:assert first['attrs']['order']==10
