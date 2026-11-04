"""Recognise only the reference-only paragraph generated before a note list/table."""
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
STYLE='AlderNotePrefix'


def mark_prefix(paragraph,document):
    from docx.enum.style import WD_STYLE_TYPE
    if STYLE not in document.styles:
        style=document.styles.add_style(STYLE,WD_STYLE_TYPE.PARAGRAPH)
        style.base_style=document.styles['Normal'];style.hidden=True;style.quick_style=False
    paragraph.get_or_add_pPr().get_or_add_pStyle().val=document.styles[STYLE].style_id


def is_prefix(paragraph,kind):
    if paragraph.tag!=f'{{{W}}}p':return False
    properties=paragraph.find(f'{{{W}}}pPr')
    if properties is None:return False
    style=properties.find(f'{{{W}}}pStyle')
    if style is None or style.get(f'{{{W}}}val')!=STYLE:return False
    if any(n is not style and not(n.tag==f'{{{W}}}rPr' and not len(n)) for n in properties):return False
    references=0;spaces=0
    for run in paragraph:
        if run is properties:continue
        if run.tag!=f'{{{W}}}r':return False
        for child in run:
            if child.tag==f'{{{W}}}{kind}Ref':references+=1
            elif child.tag==f'{{{W}}}t' and (child.text or '')==' ':spaces+=1
            elif child.tag==f'{{{W}}}rPr' and all(n.tag==f'{{{W}}}vertAlign' and n.get(f'{{{W}}}val')=='superscript' for n in child):pass
            else:return False
    return references==1 and spaces==1
