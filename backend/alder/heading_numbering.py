"""Six-level decimal heading numbering, separate from authored wording."""


def number_headings(sections):
    counts = [0] * 6
    def walk(node):
        attrs = node.get('attrs') or {}
        if node['type'] == 'heading' and attrs.get('headingNumbered'):
            level = max(1, min(6, int(attrs.get('level', 1)))) - 1
            counts[level] = attrs.get('headingStart') or counts[level] + 1
            counts[level + 1:] = [0] * (5 - level)
            attrs['_headingLabel'] = '.'.join(str(value or 1) for value in counts[:level + 1])
        for child in node.get('content', []): walk(child)
    for section in sections:
        for node in section['blocks']: walk(node)


class HeadingNumberingWriter:
    def __init__(self, document):
        self.document = document
        self.number = None
        self.counts = [0] * 6

    def apply(self, paragraph, attrs):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from .docx_support import NumberingWriter
        level = max(1, min(6, int(attrs.get('level', 1)))) - 1
        restart = attrs.get('headingStart')
        self.counts[level] = restart or self.counts[level] + 1
        self.counts[level + 1:] = [0] * (5 - level)
        if self.number is None or restart is not None:
            writer = NumberingWriter(self.document)
            self.number = writer.create(True)
            number = next(n for n in writer.root.findall(qn('w:num')) if int(n.get(qn('w:numId'))) == self.number)
            abstract_id = number.find(qn('w:abstractNumId')).get(qn('w:val'))
            abstract = next(n for n in writer.root.findall(qn('w:abstractNum')) if n.get(qn('w:abstractNumId')) == abstract_id)
            multilevel = OxmlElement('w:multiLevelType'); multilevel.set(qn('w:val'), 'multilevel'); abstract.insert(0, multilevel)
            for index, spec in enumerate(abstract.findall(qn('w:lvl'))):
                spec.find(qn('w:lvlText')).set(qn('w:val'), '.'.join(f'%{n + 1}' for n in range(index + 1)))
                # Heading text remains at its authored paragraph indentation.
                props = spec.find(qn('w:pPr'))
                if props is not None: spec.remove(props)
                if index < 6:
                    linked = OxmlElement('w:pStyle'); linked.set(qn('w:val'), self.document.styles[f'Heading {index + 1}'].style_id); spec.insert(1, linked)
                if restart is not None:
                    start = (self.counts[index] or 1) if index <= level else 1
                    override = OxmlElement('w:lvlOverride'); override.set(qn('w:ilvl'), str(index))
                    value = OxmlElement('w:startOverride'); value.set(qn('w:val'), str(start)); override.append(value); number.append(override)
        NumberingWriter.apply(paragraph, self.number, level)


def read_heading_numbering(reader, paragraph, info):
    """Recognise the exact decimal hierarchy; other list patterns stay lists."""
    if not info: return None
    from docx.oxml.ns import qn
    number, level, kind, start, marker = info
    if kind != 'ordered_list' or marker != 'decimal' or not 0 <= level < 6: return None
    num = next(n for n in reader.root.findall(qn('w:num')) if n.get(qn('w:numId')) == str(number))
    identity = num.find(qn('w:abstractNumId')).get(qn('w:val'))
    abstract = next(n for n in reader.root.findall(qn('w:abstractNum')) if n.get(qn('w:abstractNumId')) == identity)
    for index in range(level + 1):
        spec = next((n for n in abstract.findall(qn('w:lvl')) if n.get(qn('w:ilvl')) == str(index)), None)
        if spec is None: return None
        fmt, text = spec.find(qn('w:numFmt')), spec.find(qn('w:lvlText'))
        if fmt is None or fmt.get(qn('w:val')) != 'decimal' or text is None or text.get(qn('w:val')) != '.'.join(f'%{i + 1}' for i in range(index + 1)): return None
    counts = getattr(reader, '_heading_counts', [0] * 6)
    result = {'headingNumbered': True, 'level': level + 1}
    if start != counts[level] + 1: result['headingStart'] = start
    counts[level] = start
    counts[level + 1:] = [0] * (5 - level)
    reader._heading_counts = counts
    return result
