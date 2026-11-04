"""Editable Word controls retain independently numbered lists inside an item."""
import re
from .document_revisions import W
PREFIX = 'AlderNestedOutline:'


def number_inset(reader, number):
    from .list_formatting import word_list_name
    name = word_list_name(reader, number) or ''
    if not name.startswith(PREFIX):
        return 0
    match = re.fullmatch(re.escape(PREFIX) + r'([1-9][0-9]{0,4})(?::[01])?', name)
    if not match:
        raise ValueError('Invalid independent Word outline indentation.')
    value = int(match[1])
    if value > 28800:
        raise ValueError('Invalid independent Word outline indentation.')
    return value / 20


def number_continuation(reader, number):
    """A native definition owns its continuation intent in both review views.

    Older files use the control's legacy hint. An explicit native restart wins
    over the definition, including one made after opening the file in Word.
    """
    from .list_formatting import word_list_name
    cache = getattr(reader, '_nested_continuation', None)
    if cache is None:
        cache = reader._nested_continuation = {}
    if number in cache:
        return cache[number]
    name = word_list_name(reader, number) or ''
    match = re.fullmatch(r'(?:'+re.escape(PREFIX)+r'[1-9][0-9]{0,4}|AlderNestedOrdinary:[1-8]):([01])', name)
    result = True if name=='AlderOutlineContinuation' else match[1] == '1' if match else None
    if result:
        instance = next((n for n in reader.root.findall(f'{{{W}}}num') if n.get(f'{{{W}}}numId') == str(number)), None)
        if instance is not None and any(n.get(f'{{{W}}}ilvl') == '0' and n.find(f'{{{W}}}startOverride') is not None for n in instance.findall(f'{{{W}}}lvlOverride')):
            result = False
    cache[number] = result
    return result


def wrap(container, before, level, inset, continuation):
    from docx.oxml import OxmlElement
    root = container._element.body if hasattr(container._element, 'body') else container._element
    elements = [e for e in root if e not in before and e.tag != f'{{{W}}}sectPr']
    if not elements:
        raise ValueError('An independent Word outline has no content.')
    position = root.index(elements[0])
    wrapper = OxmlElement('w:sdt'); props = OxmlElement('w:sdtPr'); wrapper.append(props)
    tag = OxmlElement('w:tag'); tag.set(f'{{{W}}}val', f'{PREFIX}{level}:{round(inset * 20)}:{int(bool(continuation))}'); props.append(tag)
    alias = OxmlElement('w:alias'); alias.set(f'{{{W}}}val', 'Nested outline'); props.append(alias)
    content = OxmlElement('w:sdtContent'); wrapper.append(content)
    for element in elements:
        content.append(element)
    root.insert(position, wrapper)
    return wrapper


def boundary(wrapper):
    tag = wrapper.find(f'{{{W}}}sdtPr/{{{W}}}tag')
    name = tag.get(f'{{{W}}}val', '') if tag is not None else ''
    if not name.startswith(PREFIX):
        return None
    def fail():
        raise ValueError('This Word nested outline has incomplete or changed boundaries. The original file has not been changed.')
    match = re.fullmatch(re.escape(PREFIX) + r'([0-8]):([1-9][0-9]{0,4}):([01])', name)
    if not match or int(match[2]) > 28800:
        fail()
    props = wrapper.find(f'{{{W}}}sdtPr'); lock = props.find(f'{{{W}}}lock')
    if props.find(f'{{{W}}}dataBinding') is not None or lock is not None and lock.get(f'{{{W}}}val') != 'unlocked':
        fail()
    content = wrapper.find(f'{{{W}}}sdtContent')
    if content is None or not len(content):
        fail()
    # Word lifts a comment beginning at a control boundary out of its first
    # paragraph. Reattach annotation-only markers at the same text boundary.
    from .document_comments import word_comment_marker
    paragraphs=list(content.iter(f'{{{W}}}p'))
    if not paragraphs:fail()
    preceding=[];marker=wrapper.getprevious()
    while marker is not None and word_comment_marker(marker):
        preceding.insert(0,marker);marker=marker.getprevious()
    # Word may put displaced starts just inside sdtContent instead of beside
    # the control, particularly when its paragraphs carry deletion revisions.
    for marker in content:
        if not word_comment_marker(marker):break
        preceding.append(marker)
    position=1 if paragraphs[0].find(f'{{{W}}}pPr') is not None else 0
    for index,marker in enumerate(preceding):paragraphs[0].insert(position+index,marker)
    trailing=[]
    for marker in reversed(content):
        if not word_comment_marker(marker):break
        trailing.insert(0,marker)
    marker=wrapper.getnext()
    while marker is not None and word_comment_marker(marker):
        trailing.append(marker);marker=marker.getnext()
    for marker in trailing:paragraphs[-1].append(marker)
    return int(match[1]), int(match[2]) / 20, match[3] == '1', content
