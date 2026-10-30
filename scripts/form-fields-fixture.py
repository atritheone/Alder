"""Native Word and desktop content-control qualification fixture."""
from pathlib import Path
import json
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.form_fields import properties,field_value
from alder.publishing import build_export

def fixture():
    project=create_project(template='blank')
    project['settings'].update(documentKind='docx',includeTitle=False)
    content=[]
    for index,kind in enumerate(('plain','rich','checkbox','date','plain','date')):
        attrs=properties(dict(kind=kind,label='FIELD_'+str(index),tag='tag_'+str(index),
            blockId='field_'+str(index),lockContent=index==0,lockDelete=index in (0,1),
            checked=kind=='checkbox',dateValue='2026-10-30' if index==3 else ''))
        value=[{'type':'text','text':'VALUE_'+str(index)}] if index<2 else []
        if kind=='rich':value=[{'type':'text','text':'RICH_ALPHA','marks':[{'type':'strong'}]},
            {'type':'hard_break'},{'type':'text','text':'RICH_OMEGA','marks':[{'type':'em'},{'type':'link','attrs':{'href':'https://example.com/'}}]}]
        field={'type':'form_field','attrs':attrs,'content':field_value(attrs,value)}
        content.append({'type':'paragraph','content':[{'type':'text','text':kind+': '},field,{'type':'text','text':' after.'}]})
    project['book']={'version':1,'chapters':[{'id':'main','title':'Forms','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(project)


def block_fixture():
    import io,base64
    from PIL import Image
    p=fixture();data=io.BytesIO();Image.new('RGB',(80,40),(30,60,90)).save(data,format='PNG')
    p['assets']=[{'id':'form_picture','name':'form.png','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()}]
    paragraph=lambda value:{'type':'paragraph','content':[{'type':'text','text':value}]}
    body=[paragraph('BLOCK_ALPHA'),{'type':'ordered_list','attrs':{'order':3},'content':[
        {'type':'list_item','content':[paragraph('BLOCK_LIST_ONE')]},
        {'type':'list_item','content':[paragraph('BLOCK_LIST_TWO')]}]},
        {'type':'table','content':[{'type':'table_row','content':[
            {'type':'table_cell','content':[paragraph('BLOCK_CELL_ONE')]},
            {'type':'table_cell','content':[paragraph('BLOCK_CELL_TWO')]}]}]},
        {'type':'paragraph','content':[{'type':'inline_image','attrs':{'assetId':'form_picture','width':80,'alt':'Form picture'}},
            {'type':'text','text':'BLOCK_OMEGA','marks':[{'type':'text_style','attrs':{'fontSize':14,'color':'#253f60'}}]}]}]
    p['book']['chapters'][0]['document']['content'].append({'type':'form_block','attrs':properties({'kind':'rich','blockId':'block_form','label':'Rich section','lockContent':True,'lockDelete':True}),'content':body})
    return validate_project(p)


if __name__=='__main__':
    root=Path(sys.argv[1] if len(sys.argv)>1 else 'work/forms-word').resolve()
    root.mkdir(parents=True,exist_ok=True)
    rich_block='--block' in sys.argv
    project=block_fixture() if rich_block else fixture()
    if rich_block:
        field=project['book']['chapters'][0]['document']['content'][-1]
        field['content'][1:1]=[{'type':'paragraph','content':[{'type':'text','text':f'BLOCK_FLOW_{i:03d} This part of the form keeps its complete paragraph while the section continues across pages. The next part follows in document order.'}]} for i in range(40)]
        project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[{'type':'text','text':'AFTER_FORM'}]})
    output=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project,ensure_ascii=False),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':output,'skipListNumbers':True,
        'formControlsExpected':7 if rich_block else 6,'expectedText':['VALUE_0','RICH_ALPHA','RICH_OMEGA','2026-10-30']}),encoding='utf-8')
