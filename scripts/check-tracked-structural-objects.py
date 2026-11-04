"""Check the actual desktop-measured DOCX after native Word review."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import import_document
from alder.document_revisions import review_document,revision_summary
from alder.models import document_text
from alder.tracked_block_moves import identity_nodes
from alder.equations import parse,MML
from alder.document_notes import notes

root=Path(sys.argv[1]);source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
pending=import_document(root/'word-resaved.docx')['document'];assert len(revision_summary(pending))==1
for decision,view in [('accept','final'),('reject','original')]:
    reviewed=import_document(root/f'word-{decision}.docx')['document'];assert not revision_summary(reviewed)
    for actual in (reviewed,review_document(pending,view)):
        expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        shapes=[n for n in identity_nodes(actual) if n['type']=='shape'];assert len(shapes)==1
        assert shapes[0]['attrs']['kind']=='arrow' and shapes[0]['attrs']['alt']=='Moved diagram'
        assert shapes[0]['attrs']['width']==80 and shapes[0]['attrs']['height']==40 and shapes[0]['attrs']['fill'].lower()=='#c9d8e8'
        equations=[n for n in identity_nodes(actual) if n['type']=='equation'];assert len(equations)==1
        assert len(list(parse(equations[0]['attrs']['mathML']).iter('{'+MML+'}mfrac')))==1
        pictures=[n for n in identity_nodes(actual) if n['type']=='inline_image'];assert len(pictures)==1
        assert pictures[0]['attrs']['width']==48 and pictures[0]['attrs']['alt']=='Moved illustration'
        assert pictures[0]['attrs']['crop']['left']==10
        stories=notes([actual]);assert len(stories)==2
        for kind in ('footnote','endnote'):
            note=next(n for n in stories if n['attrs']['kind']==kind)
            assert document_text(note['attrs']['body'])==f'Moved {kind}\nNested note wording.'
            assert any(m['type']=='strong' for m in note['attrs']['body']['content'][0]['content'][0]['marks'])
            assert note['attrs']['body']['content'][1]['attrs']['order']==3
        assert [n['type'] for n in actual['content']]==[n['type'] for n in expected['content']]
print('Desktop-measured structural objects and notes retain both native Word review outcomes.')
