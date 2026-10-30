"""Ordinary list label boundaries, qualified against native Word."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
from alder.list_formatting import list_marker

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
cases=[('upper-alpha',26,3),('lower-alpha',51,3),('upper-roman',3999,2)]
expected=[list_marker(start+i,style)+'.' for style,start,count in cases for i in range(count)]
if '--check' not in sys.argv:
    p=create_project(template='blank');p['name']='List labels'
    p['settings'].update(documentKind='docx',includeTitle=False,includeToc=False,footer=False)
    p['book']={'version':1,'chapters':[{'id':'c','title':'Text','include':True,'document':{'type':'doc','content':[
        {'type':'ordered_list','attrs':{'order':start,'listStyle':style},'content':[
            {'type':'list_item','content':[{'type':'paragraph','content':[{'type':'text','text':f'OUTLINE_{style}_{i}'}]}]} for i in range(count)
        ]} for style,start,count in cases
    ]}}]}
    p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'outlineNumbersExpected':expected,'expectedText':['OUTLINE_upper-alpha_0']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    document=import_document(root/'word-resaved.docx')['document']
    labels=[]
    for node in document['content']:
        if node['type']=='ordered_list':
            attrs=node['attrs'];labels.extend(list_marker(attrs['order']+i,attrs['listStyle'])+'.' for i in range(len(node['content'])))
    assert labels==expected,(labels,expected)
    print(json.dumps({'status':'passed','labels':labels}))
