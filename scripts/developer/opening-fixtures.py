import hashlib
import json
from pathlib import Path
import sys
from docx import Document
from docx.shared import Inches
from PIL import Image, ImageDraw

directory = Path(sys.argv[1])
directory.mkdir(parents=True, exist_ok=True)
manifest=[]
def text_file(name, text, encoding='utf-8', eol='\n'):
    raw=text.replace('\n',eol).encode(encoding)
    (directory/name).write_bytes(raw)
    manifest.append({'name':name,'kind':'txt','bytes':len(raw),'characters':len(text),
                     'expectedTextSha256':hashlib.sha256(text.encode('utf-8')).hexdigest()})

text_file('Small UTF8.txt', 'ALDER_OPEN_BEGIN\nCafé — smart “quotes”; Ελληνικά 日本語 😀.\n\nA short plain text document.\nALDER_OPEN_END',eol='\r\n')
text_file('Unicode UTF16.txt', 'ALDER_OPEN_BEGIN\nUTF-16: café, naïve, 日本語, 😀.\nALDER_OPEN_END',encoding='utf-16',eol='\r\n')
line='Alder file opening benchmark: the writer reads a clear sentence and continues working.\n'
body=(line*((1024*1024)//len(line)+1))[:1024*1024]
text_file('Large 1MiB.txt','ALDER_OPEN_BEGIN\n'+body+'\nALDER_OPEN_END')
image=Image.new('RGB',(160,80),'white')
draw=ImageDraw.Draw(image);draw.rectangle((8,8,72,72),fill='navy');draw.ellipse((88,8,152,72),fill='green')
image.save(directory/'test-image.png')

document=Document()
document.add_heading('ALDER_OPEN_BEGIN',0)
document.add_heading('Formatting verification',1)
p=document.add_paragraph('A paragraph with ');p.add_run('bold text').bold=True;p.add_run(', ');p.add_run('italic text').italic=True;p.add_run(' and café — 日本語 😀.')
document.add_paragraph('First list item',style='List Bullet')
document.add_paragraph('Second list item',style='List Bullet')
table=document.add_table(rows=3,cols=3)
for r,row in enumerate(table.rows):
    for c,cell in enumerate(row.cells):cell.text=f'Cell {r+1}.{c+1}'
document.add_picture(str(directory/'test-image.png'),width=Inches(1.6))
document.add_paragraph('ALDER_OPEN_END')
name='Formatted small.docx';document.save(directory/name)
manifest.append({'name':name,'kind':'docx','bytes':(directory/name).stat().st_size,'expectFormatting':True})

document=Document();document.add_heading('ALDER_OPEN_BEGIN',0)
for i in range(1000):
    document.add_paragraph(f'Paragraph {i+1:04d}. The writer opens the document and studies the words carefully. A reader follows the argument through each paragraph. Clear formatting and reliable editing should remain available throughout the document, including its final page.')
document.add_paragraph('ALDER_OPEN_END')
name='Large 1000 paragraphs.docx';document.save(directory/name)
expected='\n'.join(paragraph.text for paragraph in document.paragraphs)
manifest.append({'name':name,'kind':'docx','bytes':(directory/name).stat().st_size,'paragraphs':1002,
                 'expectedTextSha256':hashlib.sha256(expected.encode('utf-8')).hexdigest()})

(directory/'Broken.docx').write_bytes(b'This is not a DOCX ZIP archive.')
manifest.append({'name':'Broken.docx','kind':'docx','bytes':30,'expectedRefusal':True})
(directory/'fixtures.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest))
