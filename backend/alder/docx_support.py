"""DOCX numbering and paragraph properties shared by import and export."""
from __future__ import annotations


def set_font_family(font, family):
    """Explicit authored fonts must win over Word's built-in theme aliases."""
    from docx.oxml.ns import qn
    font.name = family
    fonts = font._element.get_or_add_rPr().rFonts
    for key in ('asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme', 'csTheme'):
        fonts.attrib.pop(qn('w:' + key), None)
    for key in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
        fonts.set(qn('w:' + key), family)


class NumberingWriter:
    def __init__(self, document):
        self.root = document.part.numbering_part.element

    def create(self, ordered, start=1, marker=None):
        from .list_formatting import NUMBER_FORMATS, BULLETS
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        root = self.root
        abstract_id = max([int(e.get(qn("w:abstractNumId"))) for e in root.findall(qn("w:abstractNum"))] + [-1]) + 1
        number_id = max([int(e.get(qn("w:numId"))) for e in root.findall(qn("w:num"))] + [0]) + 1
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abstract_id))
        for level in range(9):
            item = OxmlElement("w:lvl")
            item.set(qn("w:ilvl"), str(level))
            for tag, value in (("start", str(start)), ("numFmt", NUMBER_FORMATS.get(marker, 'decimal') if ordered else "bullet"), ("lvlText", f"%{level + 1}." if ordered else BULLETS.get(marker, '\u2022')), ("suff", "space"), ("lvlJc", "left")):
                prop = OxmlElement("w:" + tag)
                prop.set(qn("w:val"), value)
                item.append(prop)
            props = OxmlElement("w:pPr")
            indent = OxmlElement("w:ind")
            indent.set(qn("w:left"), str(400 * (level + 1)))
            indent.set(qn("w:hanging"), "200")
            props.append(indent)
            item.append(props)
            abstract.append(item)
        root.insert(0, abstract)
        number = OxmlElement("w:num")
        number.set(qn("w:numId"), str(number_id))
        ref = OxmlElement("w:abstractNumId")
        ref.set(qn("w:val"), str(abstract_id))
        number.append(ref)
        root.append(number)
        return number_id

    @staticmethod
    def apply(paragraph, number, level):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        props = paragraph._p.get_or_add_pPr()
        numbering = OxmlElement("w:numPr")
        for tag, value in (("ilvl", min(8, level)), ("numId", number)):
            child = OxmlElement("w:" + tag)
            child.set(qn("w:val"), str(value))
            numbering.append(child)
        props.append(numbering)


def paragraph_attributes(paragraph):
    """Resolve paragraph inheritance without inventing absent properties."""
    from docx.oxml.ns import qn
    chain, seen = [], set()
    style = paragraph.style
    while style is not None and style.style_id not in seen:
        seen.add(style.style_id)
        chain.insert(0, style)
        style = style.base_style
    # Word omits explicit values equal to its defaults when saving. Resolve
    # those defaults before styles so a Word round trip retains their meaning.
    result = {'keepWithNext': False, 'keepTogether': False, 'pageBreakBefore': False, 'widowOrphan': True}
    defaults = paragraph.part.styles.element.find('.//' + qn('w:pPrDefault') + '/' + qn('w:pPr'))
    if defaults is not None:
        for tag, key in (('keepNext', 'keepWithNext'), ('keepLines', 'keepTogether'), ('pageBreakBefore', 'pageBreakBefore'), ('widowControl', 'widowOrphan')):
            prop = defaults.find(qn('w:' + tag))
            if prop is not None: result[key] = prop.get(qn('w:val'), '1') not in ('0', 'false', 'off')
        spacing = defaults.find(qn('w:spacing'))
        if spacing is not None:
            for attribute, key in (('before', 'spaceBefore'), ('after', 'spaceAfter')):
                value = spacing.get(qn('w:' + attribute))
                if value is not None:
                    try: result[key] = int(value) / 20
                    except ValueError: pass
            value = spacing.get(qn('w:line'))
            if value is not None:
                try:
                    rule = spacing.get(qn('w:lineRule'), 'auto')
                    if rule == 'auto': result.update(lineSpacingMode='multiple', lineHeight=int(value) / 240)
                    else: result.update(lineSpacingMode='exact' if rule == 'exact' else 'atLeast', lineSpacing=int(value) / 20)
                except ValueError: pass
    for source in [*chain, paragraph]:
        props = source.paragraph_format
        if props.alignment is not None:
            result["align"] = {0: "left", 1: "center", 2: "right", 3: "justify"}.get(int(props.alignment), "left")
        for key, attribute in (("leftIndent", "left_indent"), ("rightIndent", "right_indent"), ("firstLineIndent", "first_line_indent"), ("spaceBefore", "space_before"), ("spaceAfter", "space_after")):
            value = getattr(props, attribute)
            if value is not None:
                result[key] = value.pt
        if isinstance(props.line_spacing, float):
            result["lineHeight"] = props.line_spacing
            result["lineSpacingMode"] = "multiple"
            result.pop("lineSpacing", None)
        elif props.line_spacing is not None:
            from docx.enum.text import WD_LINE_SPACING
            result["lineSpacing"] = props.line_spacing.pt
            result["lineSpacingMode"] = "exact" if props.line_spacing_rule == WD_LINE_SPACING.EXACTLY else "atLeast"
        for key, attribute in (("keepWithNext", "keep_with_next"), ("keepTogether", "keep_together"), ("widowOrphan", "widow_control"), ("pageBreakBefore", "page_break_before")):
            value = getattr(props, attribute)
            if value is not None:
                result[key] = value
        font = getattr(source, "font", None)
        if font:
            if font.name: result["fontFamily"] = font.name
            if font.size is not None: result["fontSize"] = font.size.pt
            if font.color.rgb is not None: result["color"] = "#" + str(font.color.rgb)
    return result


def apply_paragraph_flow(props, attrs):
    from docx.shared import Pt
    from docx.enum.text import WD_LINE_SPACING
    for key, attribute in (("keepWithNext", "keep_with_next"), ("keepTogether", "keep_together"), ("widowOrphan", "widow_control"), ("pageBreakBefore", "page_break_before")):
        if type(attrs.get(key)) is bool:
            setattr(props, attribute, attrs[key])
    if attrs.get("lineSpacingMode") in ("exact", "atLeast") and isinstance(attrs.get("lineSpacing"), (float, int)):
        props.line_spacing = Pt(min(144, max(1, attrs["lineSpacing"])))
        props.line_spacing_rule = WD_LINE_SPACING.EXACTLY if attrs["lineSpacingMode"] == "exact" else WD_LINE_SPACING.AT_LEAST


class NumberingReader:
    def __init__(self, document):
        from docx.oxml.ns import qn
        self.qn = qn
        self.root = document.part.numbering_part.element
        self.counts = {}

    def info(self, paragraph):
        qn = self.qn
        props = paragraph._p.pPr
        numbering = props.numPr if props is not None else None
        style = paragraph.style
        seen = set()
        while numbering is None and style is not None and style.style_id not in seen:
            seen.add(style.style_id)
            props = style.element.pPr
            numbering = props.numPr if props is not None else None
            style = style.base_style
        if numbering is None or numbering.numId is None or numbering.numId.val == 0:
            return None
        identifier = numbering.numId.val
        level = numbering.ilvl.val if numbering.ilvl is not None else 0
        number = next((n for n in self.root.findall(qn("w:num")) if n.get(qn("w:numId")) == str(identifier)), None)
        if number is None: return None
        abstract_id = number.find(qn("w:abstractNumId")).get(qn("w:val"))
        abstract = next((n for n in self.root.findall(qn("w:abstractNum")) if n.get(qn("w:abstractNumId")) == abstract_id), None)
        if abstract is None: return None
        spec = next((n for n in abstract.findall(qn("w:lvl")) if n.get(qn("w:ilvl")) == str(level)), None)
        if spec is None: return None
        fmt = spec.find(qn("w:numFmt"))
        start = spec.find(qn("w:start"))
        start = int(start.get(qn("w:val"))) if start is not None else 1
        override = next((n for n in number.findall(qn("w:lvlOverride")) if n.get(qn("w:ilvl")) == str(level)), None)
        if override is not None:
            value = override.find(qn("w:startOverride"))
            if value is not None: start = int(value.get(qn("w:val")))
        counter = self.counts.get((identifier, level), start)
        self.counts[(identifier, level)] = counter + 1
        for key in list(self.counts):
            if key[0] == identifier and key[1] > level: del self.counts[key]
        from .list_formatting import NUMBER_FORMATS, BULLETS
        bullet = fmt is not None and fmt.get(qn('w:val')) == 'bullet'
        label = spec.find(qn('w:lvlText'))
        marker = next((key for key, value in BULLETS.items() if label is not None and value == label.get(qn('w:val'))), 'disc') if bullet else next((key for key, value in NUMBER_FORMATS.items() if fmt is not None and value == fmt.get(qn('w:val'))), 'decimal')
        return identifier, level, 'bullet_list' if bullet else 'ordered_list', counter, marker


def table_grid(rows):
    """Locate actual cells; a row span occupies columns in following rows."""
    occupied, placed, columns = set(), [], 1
    for row_index, row in enumerate(rows):
        column = 0
        for cell in row.get("content", []):
            while (row_index, column) in occupied: column += 1
            attrs = cell.get("attrs", {})
            width = max(1, min(100, int(attrs.get("colspan", 1))))
            height = max(1, min(len(rows) - row_index, int(attrs.get("rowspan", 1))))
            placed.append((row_index, column, height, width, cell))
            for r in range(row_index, row_index + height):
                for c in range(column, column + width):
                    if (r, c) in occupied: raise ValueError("Overlapping table cells cannot be exported.")
                    occupied.add((r, c))
            column += width
            columns = max(columns, column)
    return columns, placed


def import_table(table, container, warnings=None):
    from docx.table import _Cell
    from docx.oxml.ns import qn
    from .table_formatting import read_docx_cell
    rows, anchors = [], {}
    widths = [round(col.w.pt * 96 / 72) if col.w else None for col in table._tbl.tblGrid.gridCol_lst]
    for row_index, row in enumerate(table.rows):
        result, column = [], 0
        header = row._tr.trPr is not None and row._tr.trPr.find(qn("w:tblHeader")) is not None
        for element in row._tr.tc_lst:
            width = element.grid_span
            if element.vMerge == "continue":
                anchor = anchors.get(column)
                if anchor is not None: anchor["attrs"]["rowspan"] += 1
                column += width
                continue
            cell = _Cell(element, table)
            if warnings is not None and element.tcPr is not None:
                borders = element.tcPr.find(qn('w:tcBorders'))
                if borders is not None:
                    edges = [borders.find(qn('w:' + side)) for side in ('top', 'bottom', 'left', 'right')]
                    appearances = [tuple(sorted(edge.attrib.items())) if edge is not None else None for edge in edges]
                    message = 'DOCX tables with different borders on individual edges are converted to uniform cell borders.'
                    if len(set(appearances)) > 1 and message not in warnings: warnings.append(message)
            attrs = {"colspan": width, "rowspan": 1, **read_docx_cell(cell)}
            colwidth = widths[column:column + width]
            if len(colwidth) == width and all(colwidth): attrs["colwidth"] = colwidth
            node = {"type": "table_header" if header else "table_cell", "attrs": attrs, "content": container(cell)}
            result.append(node)
            for c in range(column, column + width): anchors[c] = node
            column += width
        row_attrs = {'minHeight': min(1440, row.height.pt)} if row.height is not None else {}
        if warnings is not None:
            from docx.enum.table import WD_ROW_HEIGHT_RULE
            message = 'Fixed DOCX row heights are imported as minimum heights to keep all cell content visible.'
            if row.height_rule == WD_ROW_HEIGHT_RULE.EXACTLY and message not in warnings: warnings.append(message)
        rows.append({"type": "table_row", "attrs": row_attrs, "content": result})
    from docx.enum.table import WD_TABLE_ALIGNMENT
    align = {WD_TABLE_ALIGNMENT.LEFT: 'left', WD_TABLE_ALIGNMENT.CENTER: 'center', WD_TABLE_ALIGNMENT.RIGHT: 'right'}.get(table.alignment, 'left')
    return {"type": "table", "attrs": {'align': align}, "content": rows}
