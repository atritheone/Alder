"""Bounded native Word TOC exchange; arbitrary field instructions are not run."""
import copy
import re


def indexed_children(root, parent, paragraph, warnings):
    """Recognise a whole-paragraph native INDEX without an Alder content control.

    Keep mixed prose, unsupported instructions and incomplete fields untouched.
    The candidate scan consumes each paragraph once, including malformed fields.
    """
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    elements = list(root)
    at = 0
    while at < len(elements):
        first = elements[at]
        runs = [child for child in first if child.tag != qn('w:pPr')]
        start = runs[0].find(qn('w:fldChar')) if runs and runs[0].tag == qn('w:r') else None
        instructions = []
        if first.tag == qn('w:p') and start is not None and start.get(qn('w:fldCharType')) == 'begin':
            for run in runs[1:]:
                if run.find(qn('w:fldChar')) is not None: break
                instructions.extend(node.text or '' for node in run.iter(qn('w:instrText')))
        instruction = ''.join(instructions)
        if not re.fullmatch(r'\s*INDEX\s*(?:\\c\s+"?1"?\s*)?', instruction, re.I):
            yield first
            at += 1
            continue
        depth, end, complete = 0, at, False
        while end < len(elements) and elements[end].tag == qn('w:p'):
            current = elements[end]
            for child in current:
                for control in child.iter(qn('w:fldChar')):
                    kind = control.get(qn('w:fldCharType'))
                    if kind == 'begin': depth += 1
                    elif kind == 'end':
                        depth -= 1
                        if depth == 0:
                            # Only field controls may follow the outer end; mixed
                            # prose must remain authored prose, never generated.
                            complete = child is current[-1] and all(node.tag in (qn('w:rPr'), qn('w:fldChar')) for node in child)
                            break
                if depth == 0 and child.tag != qn('w:pPr'): break
            end += 1
            if depth == 0: break
        candidate = elements[at:end]
        if complete:
            sdt = OxmlElement('w:sdt'); properties = OxmlElement('w:sdtPr')
            tag = OxmlElement('w:tag'); tag.set(qn('w:val'), 'AlderContents:1:3')
            alias = OxmlElement('w:alias'); alias.set(qn('w:val'), '')
            properties.extend([tag, alias]); sdt.append(properties)
            content = OxmlElement('w:sdtContent'); sdt.append(content)
            content.extend(copy.deepcopy(candidate))
            result = read_contents(sdt, parent, paragraph, warnings)
            if result is not None:
                yield result
            else: yield from candidate
        else: yield from candidate
        at = max(at + 1, end)


def write_contents(container, node, block, document, style_ids, warnings):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    attrs = node.get('attrs', {})
    from docx.enum.style import WD_STYLE_TYPE
    from docx.shared import Pt
    chosen = style_ids.get(attrs.get('entryStyle'), 'Normal')
    is_index=attrs.get('kind')=='index'
    captions = attrs.get('kind','headings') in ('figures','tables')
    style_key = '_alder_index_style' if is_index else '_alder_figures_style' if captions else '_alder_contents_style'
    previous = getattr(document.part, style_key, chosen)
    if previous != chosen:
        message = 'Word shares contents-entry styles across all contents fields; this export uses the first contents block\'s entry style for subsequent native updates.'
        if message not in warnings: warnings.append(message)
    setattr(document.part, style_key, previous)
    source_style = document.styles[previous]
    for level in range(1, (3 if is_index else 1 if captions else attrs.get('depth',3))+1):
        # Word distinguishes its lowercase built-in TOC names from custom styles.
        name = f'index {level}' if is_index else 'table of figures' if captions else f'toc {level}'
        style = document.styles[name] if name in document.styles else document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH, builtin=True)
        style.style_id = f'Index{level}' if is_index else 'TableofFigures' if captions else f'TOC{level}'
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
    text.text = ' INDEX \\c "1" ' if is_index else f' TOC {selector} \\h \\z ' + ('\\n ' if not attrs.get('pageNumbers',True) else ''); instruction.append(text)
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
    is_index=bool(re.fullmatch(r'\s*INDEX\s*(?:\\c\s+"?1"?\s*)?',instructions,re.I))
    if not supported and not is_index:
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
    kind = 'index' if is_index else {'figure':'figures','table':'tables'}.get((supported[2] or '').lower(),'headings')
    return {'type':'table_of_contents', 'attrs':{'title':title,'depth':3 if is_index else int(supported[1] or 1),'kind':kind,'entryStyle':None,'pageNumbers':'\\n' not in instructions.lower()}, 'content':entries or [{'type':'paragraph'}]}


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
