from pathlib import Path
import pytest
from alder.models import create_project, document_text, validate_project
from alder.publishing import build_export, import_document


@pytest.mark.parametrize('format', ['docx', 'html', 'rtf', 'odt'])
def test_wide_indents_and_hanging_lines_survive_exchange(tmp_path, format):
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, pageSize='A4', footer=False)
    style = project['styles'][0]
    style.update(leftIndent=240, firstLineIndent=-180, rightIndent=0)
    document = {'type': 'doc', 'content': [
        {'type': 'paragraph', 'attrs': {'styleId': style['id']}, 'content': [{'type': 'text', 'text': 'Wide inherited hanging indent.'}]},
        {'type': 'paragraph', 'attrs': {'leftIndent': 0, 'rightIndent': 240, 'firstLineIndent': 0}, 'content': [{'type': 'text', 'text': 'Wide right indent.'}]},
    ]}
    project['book'] = {'version': 1, 'chapters': [{'id': 'wide', 'title': 'Wide', 'include': True, 'document': document}]}
    project = validate_project(project)
    exported = build_export(project, format, tmp_path)
    opened = import_document(Path(exported['path']))['document']
    assert document_text(opened) == document_text(document)
    first, second = opened['content']
    assert first['attrs']['leftIndent'] == pytest.approx(240, abs=.05)
    assert first['attrs']['firstLineIndent'] == pytest.approx(-180, abs=.05)
    assert second['attrs']['rightIndent'] == pytest.approx(240, abs=.05)
