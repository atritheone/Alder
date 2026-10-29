"""Bounded native Word TOC exchange; arbitrary field instructions are not run."""
import copy
import re


def write_contents(container, node, block, document, style_ids, warnings):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    attrs = node.get('attrs', {})
    from docx.enum.style import WD_STYLE_TYPE
    from docx.shared import Pt
    chosen = style_ids.get(attrs.get('entryStyle'), 'Normal')
    captions = attrs.get('kind','headings') != 'headings'
    style_key = '_alder_figures_style' if captions else '_alder_contents_style'
    previous = getattr(document.part, style_key, chosen)
    if previous != chosen:
        message = 'Word shares contents-entry styles across all contents fields; this export uses the first contents block\'s entry style for subsequent native updates.'
        if message not in warnings: warnings.append(message)
    setattr(document.part, style_key, previous)
    source_style = document.styles[previous]
    for level in range(1, (1 if captions else attrs.get('depth',3))+1):
        # Word distinguishes its lowercase built-in TOC names from custom styles.
        name = 'table of figures' if captions else f'toc {level}'
        style = document.styles[name] if name in document.styles else document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH, builtin=True)
        style.style_id = 'TableofFigures' if captions else f'TOC{level}'
        style.base_style = source_style
        style.paragraph_format.left_indent = Pt((level-1)*12)
        style.paragraph_format.keep_with_next = False
    sdt = OxmlElement('w:sdt'); properties = OxmlElement('w:sdtPr')
    tag = OxmlElement('w:tag'); tag.set(qn('w:val'), 'AlderContents:1:' + str(attrs.get('depth',3))); properties.append(tag)
    alias = OxmlElement('w:alias'); alias.set(qn('w:val'), attrs.get('title','Contents')); properties.append(alias)
    sdt.append(properties); content = OxmlElement('w:sdtContent'); sdt.append(content)
    placeholder = container.add_paragraph()._p
    placeholder.addprevious(sdt)
    owner = placeholder.getparent(); owner.remove(placeholder)
    paragraphs = []
    for child in node['content']:
        before = set(owner)
        block(container, child)
        for element in list(owner):
            if element not in before:
                content.append(element)
                if element.tag == qn('w:p'): paragraphs.append(element)
    start = 1 if attrs.get('title','Contents') else 0
    first, last = paragraphs[start], paragraphs[-1]
    def marker(kind):
        run = OxmlElement('w:r'); element = OxmlElement('w:fldChar'); element.set(qn('w:fldCharType'), kind); run.append(element); return run
    instruction = OxmlElement('w:r'); text = OxmlElement('w:instrText'); text.set(qn('xml:space'), 'preserve')
    selector = ('\\c "Figure"' if attrs.get('kind') == 'figures' else '\\c "Table"') if captions else f'\\o "1-{attrs.get("depth",3)}" \\u'
    text.text = f' TOC {selector} \\h \\z ' + ('\\n ' if not attrs.get('pageNumbers',True) else ''); instruction.append(text)
    offset = 1 if first.find(qn('w:pPr')) is not None else 0
    for index, element in enumerate([marker('begin'), instruction, marker('separate')]): first.insert(offset + index, element)
    last.append(marker('end'))


def read_contents(element, parent, paragraph, warnings):
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    tag = element.find('./' + qn('w:sdtPr') + '/' + qn('w:tag'))
    match = re.fullmatch(r'AlderContents:1:([1-6])', tag.get(qn('w:val'),'') if tag is not None else '')
    if not match: return None
    alias = element.find('./' + qn('w:sdtPr') + '/' + qn('w:alias'))
    title = alias.get(qn('w:val'), 'Contents') if alias is not None else 'Contents'
    content = copy.deepcopy(element.find(qn('w:sdtContent')))
    if content is None: return None
    instructions = ''
    for run in content.iter(qn('w:r')):
        control = run.find(qn('w:fldChar'))
        if control is not None and control.get(qn('w:fldCharType')) == 'separate': break
        instructions += ''.join(n.text or '' for n in run.iter(qn('w:instrText')))
    supported = re.fullmatch(r'\s*TOC\s+\\(?:o\s+"1-([1-6])"|c\s+"(Figure|Table)")\s*(?:\\[hzun]\s*)*', instructions, re.I)
    if not supported:
        warnings.append('An edited contents field was retained as ordinary text; its instruction is not supported.')
        return None
    # Remove only the outer field's controls. Nested REF results stay native.
    depth = 0; removed = False
    for run in list(content.iter(qn('w:r'))):
        control = run.find(qn('w:fldChar')); kind = control.get(qn('w:fldCharType')) if control is not None else None
        if kind == 'begin':
            depth += 1
            if depth == 1 and not removed: run.getparent().remove(run)
        elif kind == 'end':
            if depth == 1 and not removed: run.getparent().remove(run); removed = True
            depth = max(0, depth-1)
        elif depth == 1 and not removed and (kind == 'separate' or run.find(qn('w:instrText')) is not None):
            run.getparent().remove(run)
    entries = [paragraph(Paragraph(p, parent)) for p in content if p.tag == qn('w:p')]
    kind = {'figure':'figures','table':'tables'}.get((supported[2] or '').lower(),'headings')
    return {'type':'table_of_contents', 'attrs':{'title':title,'depth':int(supported[1] or 1),'kind':kind,'entryStyle':None,'pageNumbers':'\\n' not in instructions.lower()}, 'content':entries or [{'type':'paragraph'}]}


def restore_contents_links(document):
    """Word rewrites TOC results as hyperlinks; recover stable heading targets."""
    from uuid import uuid4
    from .document_contents import refresh_contents
    def contains(node):
        return node['type'] == 'table_of_contents' or any(contains(c) for c in node.get('content', []))
    if not contains(document): return
    targets = {}
    def collect(node):
        if node['type'] == 'table_of_contents': return
        if node['type'] == 'heading' or node.get('attrs',{}).get('captionLabel'):
            attrs=node.setdefault('attrs',{}); attrs.setdefault('blockId','block_'+uuid4().hex)
            for child in node.get('content',[]):
                if child['type']=='bookmark':
                    ca=child['attrs']
                    targets[ca['name']]=attrs['blockId']
                    if ca.get('blockId'): targets[ca['blockId']]=attrs['blockId']
        for child in node.get('content',[]): collect(child)
    collect(document)
    found=False
    def restore(node):
        nonlocal found
        if node['type']=='table_of_contents':
            found=True
            for entry in node.get('content',[]):
                links={m['attrs']['href'][1:] for n in entry.get('content',[]) for m in n.get('marks',[]) if m['type']=='link' and m.get('attrs',{}).get('href','').startswith('#')}
                if len(links)==1:
                    target=targets.get(next(iter(links)))
                    if target:
                        pages=[c for c in entry.get('content',[]) if c['type']=='cross_reference' and c['attrs'].get('referenceFormat')=='page']
                        entry['content']=[{'type':'cross_reference','attrs':{'targetId':target},'content':[{'type':'text','text':'Contents entry'}]},*pages]
            return
        for child in node.get('content',[]):restore(child)
    restore(document)
    if found: refresh_contents([document])
