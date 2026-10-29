from copy import deepcopy
from pathlib import Path
import pytest
from alder.paragraph_revisions import paragraph_format, validate_paragraph_log
from alder.document_revisions import review_document


def fixture():
    before = {'type': 'paragraph', 'attrs': {'align': 'left', 'spaceAfter': 0}}
    after = {'type': 'paragraph', 'attrs': {'align': 'center', 'spaceAfter': 0}}
    return {'base': before, 'records': [{'stamp': {'id': 'paragraph_format', 'author': 'Paragraph reviewer', 'date': '2026-10-29T08:00:00Z'}, 'status': 'pending', 'before': before, 'after': after}]}


def project_fixture():
    from alder.models import create_project, validate_project
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, footer=False)
    project['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Document', 'include': True, 'document': {'type': 'doc', 'content': [{'type': 'paragraph', 'attrs': {'blockId': 'reviewed', 'align': 'center', 'spaceAfter': 0, 'revisionProperties': fixture()}, 'content': [{'type': 'text', 'text': 'Reviewed paragraph'}]}]}}]}
    return validate_project(project)


def test_paragraph_revision_decisions_preserve_independent_later_properties():
    log = fixture()
    second = deepcopy(log['records'][0]); second['stamp'].update(id='second', author='Second')
    second.update(status='accepted', before=deepcopy(second['after']))
    second['after']['attrs']['spaceAfter'] = 12
    log['records'].append(second)
    original = deepcopy(log)
    assert paragraph_format(log)['attrs'] == {'align': 'center', 'spaceAfter': 12}
    assert paragraph_format(log, original=True)['attrs'] == {'align': 'left', 'spaceAfter': 12}
    assert log == original


def test_heading_and_paragraph_properties_project_without_changing_the_saved_document():
    log = fixture(); log['records'][0]['after'] = {'type': 'heading', 'attrs': {'level': 2, 'align': 'center'}}
    doc = {'type': 'doc', 'content': [{'type': 'heading', 'attrs': {'level': 2, 'blockId': 'kept', 'revisionProperties': log}, 'content': [{'type': 'text', 'text': 'Title'}]}]}
    before = deepcopy(doc)
    assert review_document(doc, 'original')['content'][0]['type'] == 'paragraph'
    assert review_document(doc, 'final')['content'][0]['attrs'] == {'blockId': 'kept', 'level': 2, 'align': 'center'}
    assert doc == before


@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_production_exchange_retains_paragraph_formatting_history(tmp_path, format):
    from alder.models import validate_project
    from alder.publishing import build_export, import_document
    project = project_fixture(); before = deepcopy(project)
    result = build_export(project, format, tmp_path)
    imported = import_document(Path(result['path']))['document']
    project['book']['chapters'][0]['document'] = imported
    imported = validate_project(project)['book']['chapters'][0]['document']
    assert imported['content'][0]['attrs']['revisionProperties']['records'][0]['stamp']['author'] == 'Paragraph reviewer'
    assert review_document(imported, 'original')['content'][0]['attrs']['align'] == 'left'
    assert review_document(imported, 'final')['content'][0]['attrs']['align'] == 'center'
    assert before['book']['chapters'][0]['document']['content'][0]['attrs']['revisionProperties'] == fixture()


def test_invalid_or_recursive_paragraph_revisions_are_rejected():
    for invalid in ({'revisionProperties': fixture()}, {'blockId': 'forbidden'}, {'paragraphBorderWidth': -10}):
        log = fixture(); log['base']['attrs'].update(invalid)
        with pytest.raises(ValueError): validate_paragraph_log(log)


def test_copying_a_chapter_gives_paragraph_revisions_independent_ids():
    from alder.models import validate_project
    project = project_fixture(); duplicate = deepcopy(project['book']['chapters'][0]); duplicate['id'] = 'duplicate'
    project['book']['chapters'].append(duplicate)
    project = validate_project(project)
    ids = [chapter['document']['content'][0]['attrs']['revisionProperties']['records'][0]['stamp']['id'] for chapter in project['book']['chapters']]
    assert len(set(ids)) == 2
    assert validate_project(project)['book'] == project['book']


def test_word_export_refuses_independent_overlapping_and_font_property_revisions(tmp_path):
    from alder.publishing import build_export
    project = project_fixture(); log = project['book']['chapters'][0]['document']['content'][0]['attrs']['revisionProperties']
    another = deepcopy(log['records'][0]); another['stamp']['id'] = 'other'; log['records'].append(another)
    with pytest.raises(ValueError, match='Overlapping paragraph'): build_export(project, 'docx', tmp_path)
    log['records'].pop(); log['records'][0]['after']['attrs']['fontSize'] = 20
    with pytest.raises(ValueError, match='style or font revision'): build_export(project, 'docx', tmp_path)
