from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.publishing import build_export,import_document
from alder.document_comments import walk
from test_tracked_item_moves import fixture as moved_fixture

def fixture(kind='insertion',outline=False,grouped=False,comments=False):
    project=moved_fixture(outline,comments,continued=True)
    items=project['book']['chapters'][0]['document']['content'][0]['content'];items.pop()
    changed=items[1];old=changed['attrs'].pop('revisionMove')
    changed['attrs']['revisionBlock']={**old,'kind':kind,'stamp':{k:v for k,v in old['stamp'].items() if k!='move'}}
    if grouped:
        other={'type':'list_item','attrs':{'blockId':'second_item','revisionBlock':{**deepcopy(changed['attrs']['revisionBlock']),'originalId':'second_item'}},'content':[{'type':'paragraph','content':[{'type':'text','text':'Second changed item'}]}]}
        if comments:other['content'][0]['content'].append(changed['content'][-1]['content'].pop())
        items.insert(2,other)
        for part,item in enumerate(items[1:3]):item['attrs']['revisionBlock'].update(count=2,part=part)
    return validate_project(project)

@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('outline,grouped,comments',[(False,False,False),(True,False,True),(False,True,True)])
def test_changed_items_keep_subparagraphs_sublists_comments_and_numbering(tmp_path,kind,format,outline,grouped,comments):
    project=fixture(kind,outline,grouped,comments);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert actual['content'][-1]['attrs']['order']==expected['content'][-1]['attrs']['order']
        anchors=lambda doc:[n['attrs']['edge'] for n in walk(doc) if n['type']=='comment_anchor']
        assert anchors(actual)==anchors(expected)

@pytest.mark.parametrize('damage',['all-changed','partial-range','incomplete-group'])
def test_invalid_item_changes_refuse_without_losing_content(damage):
    project=fixture(grouped=True,comments=True);items=project['book']['chapters'][0]['document']['content'][0]['content']
    if damage=='all-changed':items[:]=items[1:3]
    elif damage=='partial-range':items[-1]['content'][0]['content'].append(items[2]['content'][0]['content'].pop())
    else:items.pop(2)
    with pytest.raises(ValueError):validate_project(project)

@pytest.mark.parametrize('kind',['insertion','deletion'])
def test_word_empty_item_keeps_its_revision_without_empty_content_wrapper(tmp_path,kind):
    from docx import Document
    from docx.oxml.ns import qn
    project=fixture(kind);source=project['book']['chapters'][0]['document']
    source['content'][0]['content'][1]['content']=[{'type':'paragraph'}]
    path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    tag=qn('w:ins' if kind=='insertion' else 'w:del')
    for p in word.element.iter(qn('w:p')):
        for wrapper in list(p):
            if wrapper.tag==tag and not len(wrapper):p.remove(wrapper)
    word.save(path)
    restored=import_document(path)['document'];assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert len(actual['content'][0]['content'])==len(expected['content'][0]['content'])
