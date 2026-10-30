import copy
from pathlib import Path
import pytest
from lxml import etree as E
from docx import Document
from alder.equations import MML, OM, parse, validate, to_word, from_word, describe
from alder.models import create_project,validate_project,validate_document,ValidationError
from alder.publishing import build_export,import_document

SAMPLES=[
 '<mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow>',
 '<mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mi>d</mi><mi>x</mi></mrow>',
 '<mrow><mover accent="true"><mi>v</mi><mo>→</mo></mover><mo>+</mo><mover accent="true"><mrow><mi>A</mi><mi>B</mi></mrow><mo>¯</mo></mover></mrow>',
 '<mrow><mo>(</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo>)</mo></mrow>',
 '<mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mroot><mi>x</mi><mn>3</mn></mroot></mrow>',
]
def equation(source,index=0):
 value=f'<math xmlns="{MML}">{source}</math>'
 return {'type':'equation','attrs':{'mathML':value,'latex':'','blockId':'math_'+str(index)},'content':[{'type':'text','text':describe(parse(value))}]}
def fixture():
 p=create_project(template='blank');p['name']='Equations';p['settings'].update(documentKind='docx',includeTitle=False)
 p['book']={'version':1,'chapters':[{'id':'main','title':'Equations','include':True,'document':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':f'FORMULA_{i} '},equation(s,i),{'type':'text','text':' after.'}]} for i,s in enumerate(SAMPLES)]}}]}
 return validate_project(p)
def equations(n):
 return ([n] if n['type']=='equation' else [])+sum([equations(c) for c in n.get('content',[])],[])

@pytest.mark.parametrize('source',SAMPLES)
def test_office_math_retains_every_term_and_structure(source):
 n=equation(source);out=to_word(n)
 assert out.tag=='{'+OM+'}oMath'
 restored=from_word(out);validate(restored)
 def tokens(value):return ''.join(n.text or '' for n in parse(value).iter() if E.QName(n).localname in ('mi','mn','mo','mtext'))
 assert tokens(restored['attrs']['mathML'])==tokens(n['attrs']['mathML'])
 assert not any(n.tag.endswith('}drawing') for n in out.iter())

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_export_and_import_equations(tmp_path,format):
 p=fixture();before=copy.deepcopy(p)
 exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))
 items=equations(restored['document']);assert len(items)==len(SAMPLES)
 validate_document(restored['document']);assert p==before
 if format=='docx':assert len(list(Document(exported['path']).element.iter('{'+OM+'}oMath')))==len(SAMPLES)
 else:
  for original,actual in zip(equations(p['book']['chapters'][0]['document']),items):
   assert actual['attrs']['mathML']==original['attrs']['mathML']
   assert actual['content']==original['content']

@pytest.mark.parametrize('bad',[
 '<math><mi>x</mi></math>',f'<math xmlns="{MML}"><script>bad</script></math>',
 f'<math xmlns="{MML}" href="https://example.com"><mi>x</mi></math>',
 f'<math xmlns="{MML}"><mfrac><mi>x</mi></mfrac></math>',
 f'<!DOCTYPE math [<!ENTITY x SYSTEM "file:///private">]><math xmlns="{MML}"><mi>&x;</mi></math>',
 f'<math xmlns="{MML}">'+('<mrow>'*34)+'<mi>x</mi>'+('</mrow>'*34)+'</math>',
])
def test_invalid_math_is_rejected(bad):
 with pytest.raises(ValueError):parse(bad)

def test_unsupported_word_math_is_refused():
 with pytest.raises(ValueError,match='Unsupported Word equation'):from_word(E.fromstring(f'<m:oMath xmlns:m="{OM}"><m:phant/></m:oMath>'))

@pytest.mark.parametrize('format',['pdf','odt','rtf','azw3'])
def test_unqualified_conversion_refuses_formulas(tmp_path,format):
 with pytest.raises(ValueError,match='equations'):build_export(fixture(),format,tmp_path)
 assert not list(tmp_path.glob('*.'+format))

def test_description_and_marks_validation():
 n=equation(SAMPLES[0]);n['content']=[]
 with pytest.raises(ValueError):validate(n)
 n=equation(SAMPLES[0]);n['marks']=[{'type':'strong'}]
 with pytest.raises(ValueError):validate(n)

def test_standard_mathml_import_keeps_formula_and_discards_alternate_source(tmp_path):
    source=tmp_path/'math.html'
    source.write_text(f'<p>Before <math xmlns="{MML}"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">untrusted alternate source</annotation></semantics></math> after.</p>',encoding='utf-8')
    restored=import_document(source)['document'];items=equations(restored)
    assert len(items)==1
    assert items[0]['content'][0]['text']=='fraction a over b end fraction'
    assert 'untrusted' not in items[0]['attrs']['mathML']
    validate_document(restored)

@pytest.mark.parametrize('variant',['double-struck','script','bold-script','fraktur','bold-fraktur','sans-serif','sans-serif-italic','bold-sans-serif','sans-serif-bold-italic','monospace'])
def test_mathematical_alphabets_are_not_flattened_in_word(variant):
    source=equation(f'<mstyle mathvariant="{variant}"><mfrac><mi>R</mi><msqrt><mi>x</mi></msqrt></mfrac></mstyle>')
    restored=from_word(to_word(source));tokens=[n for n in parse(restored['attrs']['mathML']).iter() if E.QName(n).localname=='mi']
    assert [n.get('mathvariant') for n in tokens]==[variant,variant]
