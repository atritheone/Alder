"""Anchored local review threads and bounded Word comment exchange."""
from copy import deepcopy
from datetime import datetime
import json
import re
from uuid import uuid4

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
EXT_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'


def validate_anchor(attrs):
    if not isinstance(attrs.get('threadId'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', attrs['threadId']):
        raise ValueError('A comment needs a valid identity.')
    if attrs.get('edge') not in ('start', 'end'):
        raise ValueError('A comment anchor must be a start or end.')
    thread = attrs.get('thread')
    if not isinstance(thread, dict) or type(thread.get('resolved')) is not bool:
        raise ValueError('A comment needs a thread and resolution status.')
    entries = thread.get('entries')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
        raise ValueError('A comment thread needs 1–1000 entries.')
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', entry['id']) or entry['id'] in seen:
            raise ValueError('Comment entries need distinct identities.')
        seen.add(entry['id'])
        if not isinstance(entry.get('author'), str) or len(entry['author']) > 200 or not isinstance(entry.get('text'), str) or not entry['text'].strip() or len(entry['text']) > 10000:
            raise ValueError('Comment author/text is missing or too long.')
        date = entry.get('date')
        if not isinstance(date, str) or len(date) > 40:
            raise ValueError('Invalid comment date.')
        if date:
            try:
                datetime.fromisoformat(date.replace('Z', '+00:00'))
            except ValueError as exc:
                raise ValueError('Invalid comment date.') from exc


def html_anchor(element):
    try:
        attrs = {'threadId': element.get('data-comment-thread'), 'edge': element.get('data-comment-edge'),
                 'thread': json.loads(element.get('data-comment-content', 'null'))}
        validate_anchor(attrs)
        return {'type': 'comment_anchor', 'attrs': attrs}
    except (ValueError, TypeError):
        return None


def walk(node):
    yield node
    for child in node.get('content', []):
        yield from walk(child)


class WordCommentsWriter:
    def __init__(self, document, sections, warnings):
        from lxml import etree
        self.document, self.warnings = document, warnings
        self.ext = etree.Element(f'{{{W15}}}commentsEx', nsmap={'w15': W15})
        self.ids, self.emitted = {}, set()
        anchors = {}
        for section in sections:
            for node in walk({'content': section['blocks']}):
                if node.get('type') == 'comment_anchor':
                    attrs = node['attrs']; anchors.setdefault(attrs['threadId'], []).append(attrs['edge'])
        self.incomplete = {key for key, edges in anchors.items() if edges != ['start', 'end']}
        if self.incomplete:
            warnings.append('Incomplete comment anchors were exported at their remaining position; all comment text was retained.')

    def register(self, attrs):
        from lxml import etree
        thread_id = attrs['threadId']
        if thread_id in self.ids:
            return self.ids[thread_id]
        parent = None
        self.ids[thread_id] = []
        for entry in attrs['thread']['entries']:
            comment = self.document.comments.add_comment(entry['text'], author=entry['author'], initials='')
            self.ids[thread_id].append(str(comment.comment_id))
            if entry['date']:
                comment._element.set(f'{{{W}}}date', entry['date'])
            else:
                comment._element.attrib.pop(f'{{{W}}}date', None)
            for paragraph in comment.paragraphs:
                para_id = f'{(uuid4().int & 0x7FFFFFFF) or 1:08X}'
                paragraph._p.set(f'{{{W14}}}paraId', para_id)
            extra = etree.SubElement(self.ext, f'{{{W15}}}commentEx')
            extra.set(f'{{{W15}}}paraId', para_id)
            extra.set(f'{{{W15}}}done', '1' if attrs['thread']['resolved'] else '0')
            if parent:
                extra.set(f'{{{W15}}}paraIdParent', parent)
            else:
                parent = para_id
        return self.ids[thread_id]

    def inline(self, paragraph, attrs):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        key = attrs['threadId']; identifiers = self.register(attrs)
        def marker(kind, identifier):
            item = OxmlElement('w:' + kind); item.set(qn('w:id'), identifier)
            paragraph._p.append(item)
        def end():
            for identifier in identifiers:
                marker('commentRangeEnd', identifier)
                run = paragraph.add_run()
                properties = OxmlElement('w:rPr'); style = OxmlElement('w:rStyle'); style.set(qn('w:val'), 'CommentReference'); properties.append(style); run._r.append(properties)
                reference = OxmlElement('w:commentReference'); reference.set(qn('w:id'), identifier)
                run._r.append(reference)
        def start():
            for identifier in identifiers: marker('commentRangeStart', identifier)
        if key in self.incomplete:
            if key not in self.emitted:
                start(); end(); self.emitted.add(key)
        elif attrs['edge'] == 'start':
            start()
        else:
            end()

    def finish(self):
        if not self.ids:
            return
        from docx.opc.part import XmlPart
        from docx.opc.packuri import PackURI
        from docx.oxml.ns import qn
        comments = self.document.comments._comments_elm
        comments.set('{http://schemas.openxmlformats.org/markup-compatibility/2006}Ignorable', 'w14')
        for setting in self.document.settings._element.iter(qn('w:compatSetting')):
            if setting.get(qn('w:name')) == 'compatibilityMode':
                setting.set(qn('w:val'), '15')
        part = XmlPart(PackURI('/word/commentsExtended.xml'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml', self.ext, self.document.part.package)
        self.document.part.relate_to(part, EXT_REL)


class WordCommentsReader:
    def __init__(self, archive, parse_xml, warnings):
        self.threads, self.seen, self.warn = {}, set(), warnings
        if 'word/comments.xml' not in archive.namelist():
            return
        comments = parse_xml(archive.read('word/comments.xml'))
        extras = {}
        if 'word/commentsExtended.xml' in archive.namelist():
            for item in parse_xml(archive.read('word/commentsExtended.xml')):
                extras[item.get(f'{{{W15}}}paraId')] = (item.get(f'{{{W15}}}paraIdParent'), item.get(f'{{{W15}}}done') in ('1', 'true', 'on'))
        values, by_para = {}, {}
        for item in comments:
            key = item.get(f'{{{W}}}id')
            if key is None:
                continue
            paragraphs = list(item.iter(f'{{{W}}}p'))
            # Comments are plain review prose. Do not evaluate fields or links.
            text = '\n'.join(''.join(('\t' if e.tag == f'{{{W}}}tab' else '\n' if e.tag == f'{{{W}}}br' else e.text or '') for e in p.iter() if e.tag in (f'{{{W}}}t', f'{{{W}}}tab', f'{{{W}}}br')) for p in paragraphs)
            if not text.strip():
                text = '[Empty comment]'
            para = paragraphs[-1].get(f'{{{W14}}}paraId') if paragraphs else None
            parent, resolved = extras.get(para, (None, False))
            entry = {'id': 'entry_' + uuid4().hex, 'author': item.get(f'{{{W}}}author', ''), 'date': item.get(f'{{{W}}}date', ''), 'text': text}
            values[key] = {'entry': entry, 'parent': parent, 'resolved': resolved}
            if para:
                by_para[para] = key
            if any(e.tag in (f'{{{W}}}tbl', f'{{{W}}}drawing', f'{{{W}}}hyperlink', f'{{{W}}}fldSimple') for e in item.iter()):
                message = 'Rich Word comments were imported as review text; inspect the original for embedded objects or fields.'
                if message not in warnings: warnings.append(message)
        roots = {}
        for key in values:
            root, visited = key, set()
            while values[root]['parent'] in by_para:
                if root in visited:
                    root = key
                    if 'Circular Word comment replies were imported as separate threads.' not in warnings:
                        warnings.append('Circular Word comment replies were imported as separate threads.')
                    break
                visited.add(root); root = by_para[values[root]['parent']]
            roots[key] = root
        for key, root in roots.items():
            if root not in self.threads:
                children = [k for k, r in roots.items() if r == root and k != root]
                attrs = {'threadId': 'comment_' + uuid4().hex, 'edge': 'start', 'thread': {'entries': [values[k]['entry'] for k in [root] + children], 'resolved': values[root]['resolved']}}
                validate_anchor(attrs)
                self.threads[root] = attrs
        self.reply_ids = {key for key, root in roots.items() if key != root}

    def anchor(self, element):
        key = element.get(f'{{{W}}}id'); tag = element.tag.rsplit('}', 1)[-1]
        if key not in self.threads:
            return None
        edge = 'start' if tag == 'commentRangeStart' else 'end'
        if tag == 'commentReference':
            if key in self.seen: return None
            edge = 'start'
        self.seen.add(key)
        return {'type': 'comment_anchor', 'attrs': {**deepcopy(self.threads[key]), 'edge': edge}}

    def finish(self, doc):
        # Keep unanchored/header-only review text visible as incomplete anchors.
        pending = [attrs for key, attrs in self.threads.items() if key not in self.seen]
        if pending:
            doc['content'].append({'type': 'paragraph', 'content': [{'type': 'comment_anchor', 'attrs': deepcopy(attrs)} for attrs in pending]})
            self.warn.append('Comments without a supported body anchor were retained as incomplete anchors at the end of the document.')
