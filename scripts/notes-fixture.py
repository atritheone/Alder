import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.document_notes import notes
from alder.models import document_text
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_notes.py'))['fixture']()
    if '--numbering' in sys.argv:
        from alder.note_options import note_options
        options=note_options();options['footnote'].update(format='upperRoman',start=3,restart='section',placement='beneathText');options['endnote'].update(format='decimal',start=5)
        project['settings']['noteOptions']=options
        project['book']['chapters'][0]['document']['content'].insert(1,{'type':'section_break','attrs':{'kind':'nextPage'}})
    if '--long' in sys.argv:
        for index,node in enumerate(notes([project['book']['chapters'][0]['document']])):
            node['attrs']['body']['content'] += [{'type':'paragraph','content':[{'type':'text','text':f'NOTE{index}_LINE{line:03} — A source passage retained across note fragments.'}]} for line in range(40)]
    if '--references' in sys.argv:
        project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[
            {'type':'text','text':'REFERENCE_FOOTNOTE '},{'type':'cross_reference','attrs':{'targetId':'first','referenceFormat':'number'},'content':[{'type':'text','text':'stale'}]},
            {'type':'text','text':' REFERENCE_ENDNOTE '},{'type':'cross_reference','attrs':{'targetId':'third','referenceFormat':'number'},'content':[{'type':'text','text':'stale'}]},
        ]})
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':2,'endnotesExpected':1,'skipListNumbers':True,'expectedText':['BODY FIRST','BODY SECOND','BODY FINAL']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx');found=notes([restored['document']]);assert len(found)==3
    pdf=PdfReader(root/'word-rendered.pdf');text='\n'.join(page.extract_text() for page in pdf.pages)
    for label in ('FOOTNOTE ONE','FOOTNOTE TWO','ENDNOTE ONE'): assert text.count(label)==1,(label,text)
    for node,label in zip(found,('FOOTNOTE ONE','FOOTNOTE TWO','ENDNOTE ONE')):assert label in document_text(node['attrs']['body'])
    original=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
    if 'noteOptions' in original['settings']:assert restored['settings']['noteOptions']==original['settings']['noteOptions'],restored['settings']
    if '--long' in sys.argv:
        for index in range(3):
            for line in range(40):
                token=f'NOTE{index}_LINE{line:03}';assert text.count(token)==1,(token,text)
    if '--references' in sys.argv:
        assert 'REFERENCE_FOOTNOTE III' in text and 'REFERENCE_ENDNOTE 5' in text,text
        references=[node for p in restored['document']['content'] for node in p.get('content',[]) if node['type']=='cross_reference']
        assert len(references)==2
        assert [node['attrs']['targetId'] for node in references]==[found[0]['attrs']['blockId'],found[2]['attrs']['blockId']]
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(pdf.pages),'notes':len(found),'warnings':restored['warnings']}))
