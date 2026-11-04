"""Native continuation styles preserve Word's unnumbered list paragraphs.

Word has no list-item container. A hidden paragraph style records the enclosing
list level and supplies its indentation, while inheriting the authored style.
Unlike point bookmarks, paragraph styles survive rejecting a native move.
"""
import hashlib
import re

PREFIX='AlderListContinuation'


def write_item_paragraph(paragraph, level, indent, styles, authored_indent=0):
    from docx.enum.style import WD_STYLE_TYPE
    from docx.shared import Pt
    base=paragraph.style
    identity=PREFIX+str(level)+'_'+hashlib.sha256((base.style_id+':'+str(indent)).encode()).hexdigest()[:16]
    existing=next((style for style in styles if style.name==identity),None)
    if existing is None:
        existing=styles.add_style(identity,WD_STYLE_TYPE.PARAGRAPH)
        existing.base_style=base;existing.hidden=True;existing.quick_style=False
        existing.paragraph_format.left_indent=Pt(indent)
        existing.paragraph_format.first_line_indent=Pt(0)
    paragraph.style=existing
    paragraph.paragraph_format.left_indent=Pt(indent+authored_indent)


def fail_item_boundary():
    raise ValueError('This Word list has incomplete or changed paragraph boundaries. Its original file has not been changed.')


def read_item_paragraph(paragraph):
    style=paragraph.style
    if style is None or not style.name.startswith(PREFIX):return None
    # Word regenerates style IDs (including removing underscores) on save;
    # the native style name and its inheritance are stable.
    match=re.fullmatch(PREFIX+r'([0-8])_[a-f0-9]{16}',style.name)
    indent=style.paragraph_format.left_indent
    if match is None or indent is None or style.base_style is None:fail_item_boundary()
    return int(match.group(1)),indent.pt
