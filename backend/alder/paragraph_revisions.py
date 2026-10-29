"""Independent paragraph property edits, including paragraph/heading changes."""
from copy import deepcopy


def validate_paragraph_log(log):
    from .document_revisions import validate_revision
    from .models import validate_document
    def appearance(value):
        if not isinstance(value, dict) or value.get('type') not in ('paragraph', 'heading') or not isinstance(value.get('attrs'), dict) or any(key in value['attrs'] for key in ('revisionProperties', 'blockId')):
            raise ValueError('Invalid reviewed paragraph properties.')
        validate_document({'type': 'doc', 'content': [value]})
    if not isinstance(log, dict) or not isinstance(log.get('records'), list) or not 1 <= len(log['records']) <= 1000:
        raise ValueError('Invalid paragraph revision history.')
    appearance(log.get('base'))
    for record in log['records']:
        if not isinstance(record, dict) or record.get('status') not in ('pending', 'accepted', 'rejected'):
            raise ValueError('Invalid paragraph revision record.')
        validate_revision(record.get('stamp')); appearance(record.get('before')); appearance(record.get('after'))


def paragraph_format(log, original=False):
    validate_paragraph_log(log)
    result = deepcopy(log['base'])
    for record in log['records']:
        if record['status'] == 'rejected' or (original and record['status'] == 'pending'): continue
        before, after = record['before'], record['after']
        if before['type'] != after['type']: result['type'] = after['type']
        for key in before['attrs'].keys() | after['attrs'].keys():
            if key in before['attrs'] and key in after['attrs'] and before['attrs'][key] == after['attrs'][key]: continue
            if key in after['attrs']: result['attrs'][key] = deepcopy(after['attrs'][key])
            else: result['attrs'].pop(key, None)
    if result['type'] != 'heading': result['attrs'].pop('level', None)
    return result


def native_paragraph_revision(log):
    """Word stores one complete previous pPr, rather than independent records."""
    validate_paragraph_log(log)
    pending = {tuple(r['stamp'].get(k, '') for k in ('id', 'author', 'date')) for r in log['records'] if r['status'] == 'pending'}
    if len(pending) > 1:
        raise ValueError('Overlapping paragraph formatting revisions cannot yet be represented in Word without losing authorship. Review those changes first, or keep the Alder document.')
    if not pending: return None
    original, final = paragraph_format(log, True), paragraph_format(log)
    if original['attrs'].get('headingNumbered') or final['attrs'].get('headingNumbered'):
        raise ValueError('Review numbered-heading formatting before Word exchange; its original numbering properties cannot yet be represented without losing revision evidence.')
    # Font changes also affect the paragraph's runs; they require rPrChange in
    # addition to pPrChange. Do not export only half of the revision.
    unchanged = ('styleId', 'level', 'fontFamily', 'fontSize', 'color', 'captionLabel', 'captionTargetId', 'headingNumbered', 'headingStart')
    if original['type'] != final['type'] or any(original['attrs'].get(k) != final['attrs'].get(k) for k in unchanged):
        raise ValueError('This paragraph style or font revision needs combined Word paragraph/run formatting. Review that change first, or keep the Alder document.')
    stamp = next(r['stamp'] for r in log['records'] if r['status'] == 'pending')
    return stamp, original


def write_paragraph_revision(paragraph, log, writer, line_height, warnings):
    from docx.oxml import OxmlElement
    from docx.text.paragraph import Paragraph
    from .docx_support import apply_paragraph_properties
    from .document_revisions import W
    native = native_paragraph_revision(log)
    if not native: return
    stamp, previous = native
    prior = Paragraph(OxmlElement('w:p'), paragraph._parent)
    prior.style = paragraph.style
    apply_paragraph_properties(prior, previous['attrs'], line_height, warnings)
    change = OxmlElement('w:pPrChange')
    key = tuple(stamp.get(k, '') for k in ('id', 'author', 'date'))
    change.set(f'{{{W}}}id', writer.ids.setdefault(key, str(len(writer.ids))))
    change.set(f'{{{W}}}author', stamp.get('author', ''))
    if stamp.get('date'): change.set(f'{{{W}}}date', stamp['date'])
    change.append(deepcopy(prior._p.get_or_add_pPr()))
    paragraph._p.get_or_add_pPr().append(change)


def read_paragraph_revision(paragraph, reader, warnings):
    from docx.text.paragraph import Paragraph
    from .docx_support import paragraph_attributes
    from .document_revisions import W
    props = paragraph._p.pPr
    change = props.find(f'{{{W}}}pPrChange') if props is not None else None
    if change is None: return None
    previous = change.find(f'{{{W}}}pPr')
    allowed = {'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'tabs', 'spacing', 'ind', 'jc', 'pBdr', 'shd', 'contextualSpacing', 'rPr', 'pPrChange'}
    attribute_sets = {'spacing': {'before', 'after', 'line', 'lineRule'}, 'ind': {'left', 'right', 'firstLine', 'hanging'}, 'jc': {'val'}, 'pStyle': {'val'}}
    for source in (props, previous):
        if source is None or any(child.tag.rsplit('}', 1)[-1] not in allowed for child in source):
            raise ValueError('This Word paragraph revision contains unsupported properties. The original file has not been changed.')
        contextual = source.find(f'{{{W}}}contextualSpacing')
        if contextual is not None and contextual.get(f'{{{W}}}val', '1') not in ('0', 'false', 'off'):
            raise ValueError('Contextual spacing revisions are not yet supported. The original file has not been changed.')
        for tag, supported in attribute_sets.items():
            element = source.find(f'{{{W}}}{tag}')
            if element is not None and any(key.rsplit('}', 1)[-1] not in supported for key in element.attrib):
                raise ValueError('This Word paragraph revision contains unsupported property units. The original file has not been changed.')
        alignment = source.find(f'{{{W}}}jc')
        if alignment is not None and alignment.get(f'{{{W}}}val') not in ('left', 'center', 'right', 'both'):
            raise ValueError('This Word paragraph alignment revision is unsupported. The original file has not been changed.')
    from docx.oxml import OxmlElement
    prior = OxmlElement('w:p'); prior.append(deepcopy(previous))
    prior = Paragraph(prior, paragraph._parent)
    if prior.style.style_id != paragraph.style.style_id:
        raise ValueError('This Word paragraph style revision needs combined paragraph/run formatting. The original file has not been changed.')
    # Numbering and paragraph-mark formatting changes must not be flattened.
    before_run, after_run = previous.find(f'{{{W}}}rPr'), props.find(f'{{{W}}}rPr')
    def run_appearance(element):
        if element is None: return []
        return [(child.tag, tuple(sorted(child.attrib.items()))) for child in element if child.tag.rsplit('}', 1)[-1] not in ('ins', 'del')]
    if run_appearance(before_run) != run_appearance(after_run):
        raise ValueError('This Word paragraph-mark font revision cannot yet be retained. The original file has not been changed.')
    import re
    heading = re.fullmatch(r'Heading (\d)', paragraph.style.name or '')
    kind = 'heading' if heading else 'paragraph'
    notices = []
    before, after = paragraph_attributes(prior, notices), paragraph_attributes(paragraph, notices)
    if notices:
        raise ValueError('This Word paragraph revision requires a lossy property conversion. The original file has not been changed.')
    if heading:
        before['level'] = after['level'] = min(6, int(heading[1]))
    before, after = {'type': kind, 'attrs': before}, {'type': kind, 'attrs': after}
    if before == after:
        raise ValueError('This Word paragraph revision has no supported property difference. The original file has not been changed.')
    log = {'base': before, 'records': [{'stamp': reader.stamp(change), 'status': 'pending', 'before': before, 'after': after}]}
    validate_paragraph_log(log)
    return log
