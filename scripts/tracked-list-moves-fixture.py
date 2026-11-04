"""Verify Word's actual numbering and structure for a moved nested list."""
import json, runpy, sys
from copy import deepcopy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/tests'))
from alder.publishing import build_export, import_document
from alder.models import document_text
from alder.document_revisions import review_document, revision_summary
from alder.document_comments import walk
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
outline='--outline' in sys.argv
continued='--continued' in sys.argv
if '--check' not in sys.argv:
    fixtures=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_tracked_list_moves.py'))
    p=fixtures['multiparagraph_fixture'](outline) if '--paragraphs' in sys.argv else fixtures['outline_fixture' if outline else 'fixed_fixture']()
    if continued:
        p['book']['chapters'][0]['document']['content'][3]['attrs'].update(continuePrevious=True,order=1)
    nodes=p['book']['chapters'][0]['document']['content']
    if '--restart-between' in sys.argv:nodes[3]['attrs'].update(continuePrevious=False,order=20)
    if '--backward' in sys.argv:nodes[:]=[*nodes[-2:],*nodes[2:-2],*nodes[:2]]
    if '--moving-continuation' in sys.argv:
        for n in nodes:
            if n['type']=='ordered_list' and n.get('attrs',{}).get('revisionMove'):n['attrs']['continuePrevious']=True
        earlier=deepcopy(nodes[3]);earlier['attrs']={**earlier['attrs'],'order':7,'continuePrevious':False};earlier['content'][0]['content'][0]['content'][0]['text']='Earlier item'
        nodes.insert(0,earlier)
    if '--cell' in sys.argv:p['book']['chapters'][0]['document']['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':nodes}]}]}]
    from alder.models import validate_project
    p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    options={'docx':result,'movesExpected':1,'skipListNumbers':True,'expectedText':['Moved section','First item','Nested item','Second item','Other item'],'reviewListNumbers':{'First item':'C.','Second item':'D.','Other item':'G.',**({'Nested item':'C(a)'} if outline else {})}}
    if '--paragraphs' in sys.argv:
        options['reviewListNumbers'].update({'Second paragraph':'','Nested continuation':''})
        options['reviewParagraphIndents']={'Second paragraph':24 if outline else 7*72/25.4,'Nested continuation':48 if outline else 14*72/25.4}
    def numbers(doc):
        from alder.list_formatting import list_marker
        from alder.outline_lists import outline_layout
        result={};covered=set()
        for record in outline_layout(doc):
            covered.add(id(record['node']))
            for item in record['items']:result[document_text(item['node']['content'][0]).strip()]=item['label']
        for node in walk(doc):
            if node['type']=='ordered_list' and id(node) not in covered:
                for index,item in enumerate(node['content']):result[document_text(item['content'][0]).strip()]=list_marker(node.get('attrs',{}).get('order',1)+index,node.get('attrs',{}).get('listStyle','decimal'))+'.'
        if '--paragraphs' in sys.argv:result.update({'Second paragraph':'','Nested continuation':''})
        return result
    source=p['book']['chapters'][0]['document'];a,b=review_document(source,'original'),review_document(source,'final')
    options['reviewListNumbersByDecision']={'accept':numbers(b),'reject':numbers(a)}
    (root/'fixture-inputs.json').write_text(json.dumps({'original':a,'revised':b,'changes':1,'expectedText':['First item'],'text':{'original':document_text(a),'final':document_text(b)}}),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps(options),encoding='utf-8')
else:
    source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert len(revision_summary(restored))==1
    for decision,view in [('accept','final'),('reject','original')]:
        decided=import_document(root/f'word-{decision}.docx')['document'];assert not revision_summary(decided)
        for doc in (review_document(restored,view),decided):
            assert document_text(doc)==document_text(review_document(source,view))
            lists=[n for n in walk(doc) if n['type']=='ordered_list']
            if not outline:assert [n['attrs']['order'] for n in lists]==[n['attrs']['order'] for n in walk(review_document(source,view)) if n['type']=='ordered_list']
            moved=next(n for n in lists if document_text(n['content'][0]['content'][0]).strip()=='First item')
            assert moved['attrs']['listStyle']=='upper-alpha'
            nested=moved['content'][0]['content'][1]
            if '--paragraphs' in sys.argv:
                assert len(moved['content'])==2 and len(moved['content'][0]['content'])==4
                assert len(nested['content'][0]['content'])==2
                assert not moved['content'][0]['content'][-1].get('content')
            if outline:
                from test_outline_lists import labels
                assert labels(doc)==labels(review_document(source,view))
                assert nested['type']=='ordered_list' and moved['attrs']['listTemplate'][1]['pattern']=='%1(%2)'
            else:assert nested['type']=='bullet_list' and nested['attrs']['listStyle']=='square'
            assert any(m['type']=='strong' for m in moved['content'][0]['content'][0]['content'][0]['marks'])
    print('Native nested-list move review, numbering and structure passed.')
