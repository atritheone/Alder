"""Native Word must preserve both move sides and both review outcomes."""
import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
from alder.document_revisions import review_document,revision_summary
from alder.models import document_text,validate_project
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    fixtures={'--captions':'attached_caption_fixture','--sequences':'sequence_fixture','--citations':'citation_fixture','--indexes':'index_fixture','--references':'reference_fixture','--fields':'field_fixture','--notes':'note_fixture','--text-boxes':'text_box_fixture','--forms':'form_fixture','--shapes':'shape_fixture','--equations':'equation_fixture','--pictures':'picture_fixture','--section':'section_fixture','--blocks':'block_fixture'}
    p=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_tracked_moves.py'))[next((name for flag,name in fixtures.items() if flag in sys.argv),'fixture')]()
    result=build_export(p,'docx',root,{'measuredTextBoxes':{key:{'width':180,'height':60} for key in ('box','box_ghost')}} if '--text-boxes' in sys.argv else None)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'movesExpected':1,'skipListNumbers':True,'unlockMovedControlsForReview':any(flag in sys.argv for flag in ('--forms','--citations')),'expectedText':['Moved paragraph.','Middle paragraph.','Final paragraph.'] if any(flag in sys.argv for flag in fixtures) else ['Alpha','Beta sentence.','Gamma sentence.']}),encoding='utf-8')
else:
    project=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
    source=project['book']['chapters'][0]['document']
    def imported(path):
        result=import_document(path);doc=result['document']
        project['assets']=result['assets']
        project['book']['chapters'][0]['document']=doc
        return validate_project(project)['book']['chapters'][0]['document']
    restored=imported(root/'word-resaved.docx')
    assert len(revision_summary(restored))==1 and revision_summary(restored)[0]['move']
    def wording(document):
        if not any(arg in sys.argv for arg in ('--fields','--references','--sequences')):return document_text(document)
        def walk(node):return {**node,'content':[]} if node['type'] in ('document_field','cross_reference','sequence') else {**node,'content':[walk(c) for c in node.get('content',[])]}
        return document_text(walk(document))
    for decision,view in [('accept','final'),('reject','original')]:
        expected=wording(review_document(source,view))
        assert wording(review_document(restored,view))==expected
        decided=imported(root/f'word-{decision}.docx')
        assert not revision_summary(decided) and wording(decided)==expected
        if '--captions' in sys.argv:
            for document in (review_document(restored,view),decided):
                caption=next(node for node in document['content'] if node.get('attrs',{}).get('captionLabel'))
                picture=next(child for node in document['content'] for child in node.get('content',[]) if child['type']=='inline_image')
                assert caption['attrs']['captionTargetId']==picture['attrs']['blockId']
                picture_index=next(i for i,node in enumerate(document['content']) if picture in node.get('content',[]))
                assert document['content'].index(caption)==picture_index+1
                assert any(mark['type']=='em' for mark in caption['content'][-1]['marks'])
        if '--sequences' in sys.argv:
            for document in (review_document(restored,view),decided):
                sequences=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='sequence'];assert len(sequences)==2
                assert all(node['attrs']['sequenceName']=='Figure' and any(mark['type']=='strong' for mark in node['marks']) for node in sequences)
        if '--citations' in sys.argv:
            expected_citation=next(c for n in review_document(source,view)['content'] for c in n.get('content',[]) if c['type']=='citation')
            for document in (review_document(restored,view),decided):
                citations=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='citation'];assert len(citations)==1
                assert citations[0]['attrs']['items']==expected_citation['attrs']['items']
                assert citations[0]['attrs']['renderedStyle']=='apa'
        if '--indexes' in sys.argv:
            from alder.document_index import entries
            for document in (review_document(restored,view),decided):
                actual=entries([document]);assert len(actual)==3
                assert actual[0]['terms']==['Trees','Alder'] and actual[0]['sortTerms']==['','Alnus'] and actual[0]['indexGroup']=='P'
                assert actual[1]['see']=='See Trees'
                bookmark=next(c for n in document['content'] for c in n.get('content',[]) if c['type']=='bookmark')
                assert actual[2]['rangeId']==bookmark['attrs']['blockId']
        if '--references' in sys.argv:
            from alder.document_references import reference_values
            for document in (review_document(restored,view),decided):
                refs=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='cross_reference']
                values=reference_values([document]);assert len(refs)==6
                assert [r['attrs'].get('referenceFormat','text') for r in refs]==['text','number','page','text','number','page']
                assert values[refs[0]['attrs']['targetId']]=='Heading target'
                assert values[(refs[1]['attrs']['targetId'],'number')]=='1'
                assert refs[2]['attrs']['targetId']==refs[0]['attrs']['targetId']
                assert values[refs[3]['attrs']['targetId']]=='Passage target'
                assert values[(refs[4]['attrs']['targetId'],'number')]=='1'
                assert refs[5]['attrs']['targetId']==refs[4]['attrs']['targetId']
                assert all(any(m['type']=='strong' for m in ref['marks']) for ref in refs)
        if '--fields' in sys.argv:
            def fields(doc):return [c for n in doc['content'] for c in n.get('content',[]) if c['type']=='document_field']
            expected_fields=fields(review_document(source,view))
            for document in (review_document(restored,view),decided):
                controls=fields(document);assert len(controls)==len(expected_fields)
                for expected_field,field in zip(expected_fields,controls):
                    assert field['attrs']['fieldKind']==expected_field['attrs']['fieldKind']
                    assert field['attrs'].get('mergeKey')==expected_field['attrs'].get('mergeKey')
                    assert any(mark['type']=='strong' for mark in field['marks'])
                    if field['attrs']['fieldKind']=='merge':assert field['attrs']['mergeKey'] in document_text(field)
                    elif field['attrs']['fieldKind'] in ('page','pageCount'):assert document_text(field).isdigit()
                    else:assert document_text(field)==document_text(expected_field)
        if '--notes' in sys.argv:
            from alder.document_notes import notes
            expected_notes=notes([review_document(source,view)])
            for document in (review_document(restored,view),decided):
                actual=notes([document]);assert len(actual)==2
                for a,b in zip(expected_notes,actual):
                    assert a['attrs']['kind']==b['attrs']['kind']
                    assert document_text(a['attrs']['body'])==document_text(b['attrs']['body'])
                    assert any(m['type']=='strong' for m in b['attrs']['body']['content'][0]['content'][0]['marks'])
                    assert b['attrs']['body']['content'][1]['type']=='ordered_list' and b['attrs']['body']['content'][1]['attrs']['order']==3
        if '--text-boxes' in sys.argv:
            for document in (review_document(restored,view),decided):
                boxes=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='text_box'];assert len(boxes)==1
                assert document_text(boxes[0]).strip()=='BOX_FIRST\nBOX_LAST'
                assert abs(boxes[0]['attrs']['width']-180)<.1 and boxes[0]['attrs']['fill'].lower()=='#c9d8e8'
                assert any(m['type']=='strong' for m in boxes[0]['content'][0]['marks'])
                assert any(m['type']=='em' for m in boxes[0]['content'][-1]['marks'])
        if '--forms' in sys.argv:
            def fields(doc):return [c for n in doc['content'] for c in n.get('content',[]) if c['type']=='form_field']
            expected_fields=fields(review_document(source,view))
            for document in (review_document(restored,view),decided):
                controls=fields(document);assert len(controls)==4
                for expected_control,control in zip(expected_fields,controls):
                    assert document_text(control)==document_text(expected_control)
                    for key in ('kind','label','tag','lockContent','lockDelete','checked','dateValue'):assert control['attrs'][key]==expected_control['attrs'][key],(key,control)
                assert any(m['type']=='strong' for m in controls[1]['content'][0]['marks'])
                assert any(m['type']=='em' for m in controls[1]['content'][-1]['marks'])
        if '--pictures' in sys.argv:
            for document in (review_document(restored,view),decided):
                pictures=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='inline_image'];assert len(pictures)==1
                assert pictures[0]['attrs']['alt']=='Moved illustration' and abs(pictures[0]['attrs']['width']-96)<.1 and pictures[0]['attrs']['crop']['left']==10
        if '--shapes' in sys.argv:
            for document in (review_document(restored,view),decided):
                shapes=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='shape'];assert len(shapes)==1
                assert shapes[0]['attrs']['kind']=='arrow' and abs(shapes[0]['attrs']['width']-96)<.1 and abs(shapes[0]['attrs']['height']-48)<.1 and shapes[0]['attrs']['alt']=='Moved diagram'
        if '--equations' in sys.argv:
            from alder.equations import parse,MML
            for document in (review_document(restored,view),decided):
                formulas=[c for n in document['content'] for c in n.get('content',[]) if c['type']=='equation'];assert len(formulas)==1
                assert len(list(parse(formulas[0]['attrs']['mathML']).iter('{'+MML+'}mfrac')))==1
    print(json.dumps({'status':'passed','pairedNativeMove':True,'acceptAndReject':True}))
