"""Original page-numbering fixtures for the isolated native Word harness."""
import json
from pathlib import Path
import runpy
import sys

source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document, plain_text
from alder.page_numbering import format_page_number, section_numbering


def generate(root):
    cases = [('odd-restart', 'oddPage', 1, 'lowerRoman'),
             ('odd-adjusted', 'oddPage', 2, 'lowerRoman'),
             ('even-adjusted', 'evenPage', 1, 'upperRoman'),
             ('letters', 'nextPage', 28, 'upperLetter'),
             ('large-roman', 'nextPage', 4444, 'upperRoman')]
    for name, kind, restart, format in cases:
        destination = root / name
        destination.mkdir(parents=True, exist_ok=True)
        project = source['fixture']()
        project['settings'].update(footer=True, firstPageNumber=1, pageNumberFormat='decimal')
        content = project['book']['chapters'][0]['document']['content']
        boundary = [n for n in content if n['type'] == 'section_break'][-1]
        boundary['attrs'].update(kind=kind, numberingStart=restart, numberingFormat=format)
        content.extend([{'type':'section_break', 'attrs':{'kind':'nextPage','page':{'pageSize':'A5','marginMm':20}}}, source['paragraph']('CONTINUED_NUMBER_MARKER')])
        exports = {format: build_export(project, format, destination) for format in ('docx', 'pdf')}
        (destination / 'fixture-exports.json').write_text(json.dumps(exports), 'utf-8')
        (destination / 'numbering-case.json').write_text(json.dumps({'kind':kind,'restart':restart,'format':format}), 'utf-8')


def verify(root):
    from pypdf import PdfReader
    checks = []
    for destination in sorted(root.iterdir()):
        if not (destination / 'numbering-case.json').exists():
            continue
        case = json.loads((destination / 'numbering-case.json').read_text('utf-8'))
        exports = json.loads((destination / 'fixture-exports.json').read_text('utf-8'))
        number = section_numbering(4, case['kind'], case['restart'])[0]
        pdfs = [PdfReader(destination / 'word-rendered.pdf'), PdfReader(exports['pdf']['path'])]
        for pdf in pdfs:
            for marker, expected in [('ODD_SECTION_MARKER', number), ('CONTINUED_NUMBER_MARKER', number + 1)]:
                matches = [p.extract_text().splitlines() for p in pdf.pages if marker in p.extract_text()]
                assert len(matches) == 1
                assert format_page_number(expected, case['format']) in [line.strip() for line in matches[0]], (destination, expected, matches)
            # Explicit restarts must not cause an extra parity blank.
            assert len(pdf.pages) == 5, (destination, len(pdf.pages))
        original = import_document(exports['docx']['path'])
        returned = import_document(destination / 'word-resaved.docx')
        assert plain_text(original['document']) == plain_text(returned['document'])
        boundaries = [n['attrs'] for n in returned['document']['content'] if n['type'] == 'section_break']
        assert boundaries[1]['numberingStart'] == case['restart']
        assert boundaries[1]['numberingFormat'] == case['format']
        assert boundaries[2].get('numberingStart') is None
        assert boundaries[2]['numberingFormat'] == case['format']
        checks.append({'case': destination.name, 'labels': [format_page_number(n, case['format']) for n in (number, number + 1)]})
    assert len(checks) == 5
    report = {'status':'passed', 'checks': checks, 'scope':'Page labels, section continuation/restarts and authored text. Not complete layout equivalence.'}
    (root / 'numbering-report.json').write_text(json.dumps(report, indent=2), 'utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    root = Path(sys.argv[1]).resolve()
    if '--verify' in sys.argv:
        verify(root)
    else:
        generate(root)
