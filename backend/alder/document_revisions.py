"""Review metadata and explicit original/final projections.

The initial interchange adapter handles inline insertions and deletions. It
rejects unsupported structural revisions before import can discard evidence.
"""
from copy import deepcopy
from datetime import datetime
import re
from uuid import uuid4

REVISION_MARKS = {'revision_insertion', 'revision_deletion'}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def paragraph_appearance(values):
    return {key: value for key, value in values.items() if key not in ('blockId', 'revisionBreak') and value is not None and value != ''}


def validate_revision(attrs):
    if not isinstance(attrs, dict) or not isinstance(attrs.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', attrs['id']):
        raise ValueError('A tracked change needs a valid identity.')
    if not isinstance(attrs.get('author', ''), str) or len(attrs.get('author', '')) > 200:
        raise ValueError('A tracked change author must be at most 200 characters.')
    date = attrs.get('date', '')
    if attrs.get('move') is not None and type(attrs['move']) is not bool:
        raise ValueError('Invalid tracked move status.')
    if not isinstance(date, str) or len(date) > 40:
        raise ValueError('Invalid tracked change date.')
    if date:
        try:
            datetime.fromisoformat(date.replace('Z', '+00:00'))
        except ValueError as exc:
            raise ValueError('Invalid tracked change date.') from exc


def review_document(document, view='final', move_context=None):
    """An independent publication/view copy; never accept the source's edits."""
    if view not in ('final', 'original', 'markup'):
        raise ValueError('Unsupported review view.')
    from .tracked_block_moves import block_move_view
    document=block_move_view(document,view,move_context)
    from .item_breaks import item_break_view
    document = item_break_view(document, view)
    def walk(node):
        marks = node.get('marks', [])
        excluded = 'revision_deletion' if view == 'final' else 'revision_insertion'
        if view != 'markup' and any(mark['type'] == excluded for mark in marks):
            return None
        result = deepcopy({key: value for key, value in node.items() if key != 'content'})
        if view != 'markup' and 'marks' in result:
            from .revision_formatting import format_marks
            formatting = next((mark for mark in marks if mark['type'] == 'revision_format'), None)
            if formatting:
                result['marks'] = format_marks(formatting['attrs'], original=view == 'original') + [mark for mark in marks if mark['type'] in REVISION_MARKS]
            result['marks'] = [mark for mark in result['marks'] if mark['type'] not in REVISION_MARKS]
            if not result['marks']: result.pop('marks')
        if 'content' in node:
            result['content'] = [child for n in node['content'] if (child := walk(n)) is not None]
        return result
    def paragraphs(node):
        if view != 'markup' and node.get('attrs', {}).get('revisionProperties'):
            from .paragraph_revisions import paragraph_format
            original = paragraph_format(node['attrs']['revisionProperties'], original=view == 'original')
            node = {**node, 'type': original['type'], 'attrs': {**original['attrs'], **({'blockId': node['attrs']['blockId']} if node['attrs'].get('blockId') else {})}}
        children = []
        for child in node.get('content', []): children.extend(paragraphs(child))
        result = deepcopy({key: value for key, value in node.items() if key != 'content'})
        if node['type'] in ('paragraph', 'heading'):
            output, inline, join = [], [], None
            for child in children:
                if child['type'] != 'revision_break' or view == 'markup':
                    inline.append(child); continue
                attrs = child['attrs']
                if view == 'final': continue
                if attrs['kind'] == 'insertion': join = attrs['nextId']
                else:
                    output.append((dict(result, content=inline), join))
                    result = {'type': attrs['rightType'], 'attrs': deepcopy(attrs['rightAttrs'])}; inline = []; join = None
            output.append((dict(result, content=inline), join))
            for item, target in output:
                if target: joins[id(item)] = target
            return [item for item, target in output]
        combined = []
        for child in children:
            previous = combined[-1] if combined else None
            target = joins.get(id(previous)) if previous is not None else None
            if target:
                if child.get('attrs', {}).get('blockId') != target or child['type'] not in ('paragraph', 'heading'):
                    raise ValueError('An original-view paragraph boundary has moved apart. Review the changes separately.')
                previous.setdefault('content', []).extend(child.get('content', []))
                joins.pop(id(previous))
                if id(child) in joins: joins[id(previous)] = joins[id(child)]
            else: combined.append(child)
        if combined and id(combined[-1]) in joins:
            raise ValueError('An original-view paragraph boundary is incomplete.')
        if 'content' in node: result['content'] = combined
        return [result]
    joins = {}
    from .list_formatting import resolve_list_orders
    return resolve_list_orders(walk(paragraphs(document)[0]))


def validate_break(attrs):
    if not isinstance(attrs, dict) or attrs.get('kind') not in ('insertion', 'deletion'):
        raise ValueError('Invalid tracked paragraph boundary.')
    validate_revision(attrs.get('stamp'))
    if attrs.get('scope') is not None and attrs['scope'] != 'item':
        raise ValueError('Invalid tracked item boundary.')
    if attrs['kind'] == 'insertion' or attrs.get('scope') == 'item':
        if not isinstance(attrs.get('nextId'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', attrs['nextId']):
            raise ValueError('A tracked paragraph boundary needs its following paragraph.')
    if attrs['kind'] == 'deletion' and (attrs.get('rightType') not in (('list_item',) if attrs.get('scope') == 'item' else ('paragraph', 'heading')) or not isinstance(attrs.get('rightAttrs'), dict)):
        raise ValueError('A deleted paragraph boundary needs its original paragraph properties.')


def revision_summary(document):
    groups = {}
    def walk(node):
        records=list((node.get('attrs',{}).get('revisionProperties') or {}).get('records',[]))
        for mark in node.get('marks',[]):
            if mark.get('type')=='revision_format':records.extend(mark['attrs']['records'])
        for record in records:
            if record['status']!='pending':continue
            attrs=record['stamp'];group=groups.setdefault(attrs['id'],{**attrs,'inserted':'','deleted':''})
            group['formatting']=True
        if node['type']=='revision_break':
            change=node['attrs'];attrs=change['stamp'];group=groups.setdefault(attrs['id'],{**attrs,'inserted':'','deleted':''})
            group['inserted' if change['kind']=='insertion' else 'deleted']+='\n'
        move=node.get('attrs',{}).get('revisionMove') or node.get('attrs',{}).get('revisionBlock')
        if move:
            from .models import document_text
            attrs=move['stamp'];group=groups.setdefault(attrs['id'],{**attrs,'inserted':'','deleted':''})
            group['inserted' if move['kind']=='insertion' else 'deleted']+=''.join(document_text(c) for c in node.get('content',[]))+'\n'
        for mark in node.get('marks', []):
            if mark.get('type') in REVISION_MARKS:
                attrs = mark['attrs']; validate_revision(attrs)
                group = groups.setdefault(attrs['id'], {**attrs, 'inserted': '', 'deleted': ''})
                key = 'inserted' if mark['type'] == 'revision_insertion' else 'deleted'
                group[key] += node.get('text', '\n' if node['type'] == 'hard_break' else '')
        for child in node.get('content', []): walk(child)
    walk(document)
    return list(groups.values())


class WordRevisionWriter:
    def __init__(self):
        self.ids = {}
        self.block_moves=[]
        self.block_changes=[]

    def paragraph_break(self, paragraph, revision):
        from docx.oxml import OxmlElement
        validate_revision(revision['stamp'])
        attrs = revision['stamp']; key = (attrs['id'], attrs.get('author', ''), attrs.get('date', ''))
        properties = paragraph._p.get_or_add_pPr()
        run = properties.find(f'{{{W}}}rPr')
        if run is None:
            run = OxmlElement('w:rPr'); properties.append(run)
        marker = OxmlElement('w:ins' if revision['kind'] == 'insertion' else 'w:del')
        marker.set(f'{{{W}}}id', self.ids.setdefault(key, str(len(self.ids))))
        marker.set(f'{{{W}}}author', attrs.get('author', ''))
        if attrs.get('date'): marker.set(f'{{{W}}}date', attrs['date'])
        run.append(marker)

    def inline(self, paragraph, node, render):
        """Wrap generated runs while retaining ordinary formatting and objects."""
        from docx.oxml import OxmlElement
        marks = [mark for mark in node.get('marks', []) if mark['type'] in REVISION_MARKS]
        formatting = next((mark for mark in node.get('marks', []) if mark['type'] == 'revision_format'), None)
        if not marks and not formatting:
            return False
        clean = {**node, 'marks': [mark for mark in node.get('marks', []) if mark['type'] not in REVISION_MARKS | {'revision_format'}]}
        native = None
        if formatting:
            from .revision_formatting import native_format_revision, format_marks
            native = native_format_revision(formatting['attrs'])
            clean['marks'] = format_marks(formatting['attrs'])
        start = len(paragraph._p)
        render(paragraph, clean)
        runs = list(paragraph._p)[start:]
        for run in runs: paragraph._p.remove(run)
        if native:
            stamp, previous = native
            render(paragraph, {**clean, 'marks': previous})
            prior_runs = list(paragraph._p)[start:]
            prior = next((item for run in prior_runs for item in run.iter(f'{{{W}}}rPr')), None)
            for run in prior_runs: paragraph._p.remove(run)
            key = (stamp['id'], stamp.get('author', ''), stamp.get('date', ''))
            for item in runs:
                for run in item.iter(f'{{{W}}}r'):
                    properties = run.find(f'{{{W}}}rPr')
                    if properties is None:
                        properties = OxmlElement('w:rPr'); run.insert(0, properties)
                    change = OxmlElement('w:rPrChange')
                    change.set(f'{{{W}}}id', self.ids.setdefault(key, str(len(self.ids))))
                    change.set(f'{{{W}}}author', stamp.get('author', ''))
                    if stamp.get('date'): change.set(f'{{{W}}}date', stamp['date'])
                    change.append(deepcopy(prior) if prior is not None else OxmlElement('w:rPr'))
                    properties.append(change)
        if not marks:
            for run in runs: paragraph._p.append(run)
            return True
        outer = parent = None
        # Insertions can themselves have a later deletion by another reviewer.
        for mark in sorted(marks, key=lambda m: m['type'] != 'revision_insertion'):
            attrs = mark['attrs']; validate_revision(attrs)
            key = (attrs['id'], attrs.get('author', ''), attrs.get('date', ''))
            identifier = self.ids.setdefault(key, str(len(self.ids)))
            tag = 'ins' if mark['type'] == 'revision_insertion' else 'del'
            if attrs.get('move'):tag = 'moveTo' if mark['type'] == 'revision_insertion' else 'moveFrom'
            wrapper = OxmlElement('w:' + tag)
            wrapper.set(f'{{{W}}}id', identifier)
            wrapper.set(f'{{{W}}}author', attrs.get('author', ''))
            if attrs.get('date'): wrapper.set(f'{{{W}}}date', attrs['date'])
            if parent is not None: parent.append(wrapper)
            else: outer = wrapper
            parent = wrapper
        deleted = any(mark['type'] == 'revision_deletion' and not mark['attrs'].get('move') for mark in marks)
        for run in runs:
            if deleted:
                for text in run.iter(f'{{{W}}}t'): text.tag = f'{{{W}}}delText'
                for instruction in run.iter(f'{{{W}}}instrText'): instruction.tag = f'{{{W}}}delInstrText'
            parent.append(run)
        paragraph._p.append(outer)
        return True

    def finish_moves(self,root):
        from .tracked_moves import write_word_moves
        write_word_moves(root)
        from .tracked_block_moves import write_word_block_moves
        write_word_block_moves(root,self.block_moves)
        from .block_revisions import write_word_block_changes
        write_word_block_changes(root,self.block_changes)


class WordRevisionReader:
    def __init__(self, root):
        self.ids = {}
        from .cell_revisions import read_word_cell_changes
        self.cell_changes=read_word_cell_changes(root,self)
        from .table_revisions import read_word_table_revisions
        self.table_formats=read_word_table_revisions(root,self)
        from .table_row_revisions import read_word_row_changes
        self.row_changes=read_word_row_changes(root)
        from .block_revisions import read_word_block_changes
        self.block_changes=read_word_block_changes(root)
        from .tracked_block_moves import read_word_block_moves
        self.block_moves=read_word_block_moves(root)
        from .tracked_moves import read_word_moves
        self.moves=read_word_moves(root)
        unsupported = {'tblPrChange', 'tblGridChange', 'trPrChange', 'tcPrChange', 'sectPrChange', 'cellIns', 'cellDel', 'cellMerge', 'numberingChange'}
        for node in root.iter():
            tag = node.tag.rsplit('}', 1)[-1]
            parent = node.getparent()
            paragraph_break = parent is not None and parent.tag == f'{{{W}}}rPr' and parent.getparent() is not None and parent.getparent().tag == f'{{{W}}}pPr'
            run_format = tag == 'rPrChange' and parent is not None and parent.tag == f'{{{W}}}rPr' and parent.getparent() is not None and parent.getparent().tag == f'{{{W}}}r' and node.find(f'{{{W}}}rPr') is not None
            paragraph_format = tag == 'pPrChange' and parent is not None and parent.tag == f'{{{W}}}pPr' and parent.getparent() is not None and parent.getparent().tag == f'{{{W}}}p' and len(node) == 1 and node[0].tag == f'{{{W}}}pPr'
            if tag in unsupported or (tag == 'pPrChange' and not paragraph_format) or (tag == 'rPrChange' and not run_format) or (tag in ('ins', 'del') and parent is not None and parent.tag.rsplit('}', 1)[-1] in ('rPr', 'trPr') and not paragraph_break):
                raise ValueError('This Word document contains structural or formatting revisions that Alder cannot yet retain. The original file has not been changed.')
            if tag in ('ins', 'del') and not paragraph_break:
                if parent is None or parent.tag.rsplit('}', 1)[-1] not in ('p', 'ins', 'del', 'hyperlink') or any(child.tag.rsplit('}', 1)[-1] in ('drawing', 'pict', 'fldSimple', 'instrText', 'delInstrText', 'p', 'tbl') for child in node.iter()):
                    raise ValueError('This Word revision contains structure or objects Alder cannot yet retain. The original file has not been changed.')
            if run_format:
                from .revision_formatting import run_marks
                run_marks(parent, strict=True); run_marks(node.find(f'{{{W}}}rPr'), strict=True)

    def formatting(self, properties):
        from .revision_formatting import run_marks, format_patches
        change = properties.find(f'{{{W}}}rPrChange') if properties is not None else None
        if change is None: return None
        before = run_marks(change.find(f'{{{W}}}rPr'), strict=True)
        after = run_marks(properties, strict=True)
        patches = format_patches(before, after)
        if not patches:
            raise ValueError('This Word formatting revision has no supported property difference. The original file has not been changed.')
        return {'type': 'revision_format', 'attrs': {'base': before, 'records': [{'stamp': self.stamp(change), 'status': 'pending', 'patches': patches}]}}

    def stamp(self, element):
        key = (element.get(f'{{{W}}}id', ''), element.get(f'{{{W}}}author', ''), element.get(f'{{{W}}}date', ''))
        identity = self.ids.setdefault(key, 'change_' + uuid4().hex)
        attrs = {'id': identity, 'author': key[1], 'date': key[2]}
        validate_revision(attrs)
        return attrs

    def mark(self, element):
        kind = element.tag.rsplit('}', 1)[-1]
        if element in self.moves:
            return {'type':'revision_deletion' if kind in ('moveFrom','del') else 'revision_insertion','attrs':self.moves[element]}
        if kind not in ('ins', 'del'): return None
        # Word can reuse a numeric identifier with different authors or dates.
        attrs = self.stamp(element)
        return {'type': 'revision_insertion' if kind == 'ins' else 'revision_deletion', 'attrs': attrs}

    def paragraph_break(self, paragraph):
        properties = paragraph.find(f'{{{W}}}pPr/{{{W}}}rPr')
        if properties is None: return None
        markers = [child for child in properties if child.tag in (f'{{{W}}}ins', f'{{{W}}}del')]
        if len(markers) > 1:
            raise ValueError('Overlapping paragraph-boundary revisions are not yet supported. The original file has not been changed.')
        if not markers: return None
        mark = self.mark(markers[0])
        return {'kind': 'insertion' if mark['type'] == 'revision_insertion' else 'deletion', 'stamp': mark['attrs']}


def word_review_paragraphs(document):
    """Detached paragraph-break representation for native Word serialization."""
    from .item_breaks import item_break_view
    item_break_view(document, 'original')  # Refuse detached item boundaries before serialization.
    def walk(node):
        if node.get('type') in ('paragraph', 'heading'):
            if node.get('attrs', {}).get('revisionProperties'):
                from .paragraph_revisions import native_paragraph_revision
                native_paragraph_revision(node['attrs']['revisionProperties'])
            result, inline = [], []
            attrs, kind = deepcopy(node.get('attrs', {})), node['type']
            for child in node.get('content', []):
                if child['type'] != 'revision_break':
                    inline.append(deepcopy(child)); continue
                change = child['attrs']; validate_revision(change['stamp'])
                if change.get('scope') == 'item' and change['kind'] == 'deletion':
                    if kind != 'paragraph' or change['nextId'] != attrs.get('blockId') or attrs.get('_itemJoin'):
                        raise ValueError('A deleted item boundary has moved apart.')
                    attrs['_itemJoin'] = deepcopy(change)
                elif change['kind'] == 'insertion':
                    attrs['revisionBreak'] = {'kind': 'insertion', 'stamp': deepcopy(change['stamp']), **({'scope': 'item'} if change.get('scope') == 'item' else {})}
                else:
                    # Word's final view takes the paragraph properties of the
                    # surviving (right-hand) paragraph mark. Alder preserves
                    # the left paragraph. A differing pair requires a companion
                    # pPrChange, not silently altered publication formatting.
                    if kind != change['rightType'] or paragraph_appearance(attrs) != paragraph_appearance(change['rightAttrs']):
                        raise ValueError('This deleted paragraph break joins differently formatted paragraphs. Review that break before Word export; Alder retains both original paragraph styles.')
                    result.append({'type': kind, 'attrs': {**attrs, 'revisionBreak': {'kind': 'deletion', 'stamp': deepcopy(change['stamp'])}}, 'content': inline})
                    inline = []; kind = change['rightType']; attrs = deepcopy(change['rightAttrs'])
            result.append({'type': kind, 'attrs': attrs, 'content': inline})
            return result
        result = deepcopy({key: value for key, value in node.items() if key != 'content'})
        if 'content' in node: result['content'] = [child for source in node['content'] for child in walk(source)]
        return [result]
    return walk(document)[0]


def restore_review_paragraphs(document):
    """Retain final paragraph structure plus recoverable boundary markers."""
    from .item_breaks import restore_word_item_splits
    restore_word_item_splits(document)
    def walk(node):
        children = node.get('content', [])
        for child in children: walk(child)
        if node.get('type') in ('paragraph', 'heading'): return
        result = []; pending = None; boundary_owner = None
        for child in children:
            change = child.get('attrs', {}).pop('revisionBreak', None)
            if pending and child['type'] not in ('paragraph', 'heading'):
                table_change = child.get('attrs', {}).get('revisionBlock')
                if (pending['kind'] != 'insertion' or child['type'] != 'table' or
                    not table_change or table_change['kind'] != 'insertion' or
                    any(pending['stamp'].get(key, '') != table_change['stamp'].get(key, '') for key in ('author', 'date'))):
                    raise ValueError('This tracked paragraph boundary crosses unsupported structure. The original file has not been changed.')
                # Word assigns separate IDs to the paragraph mark and table rows.
                # They form one dependent insertion: rejection removes the table
                # before rejoining the prose on either side.
                table_change['stamp'] = deepcopy(pending['stamp'])
                result.append(child)
                continue
            if pending and pending['kind'] == 'deletion':
                if result[-1]['type'] != child['type'] or paragraph_appearance(result[-1].get('attrs', {})) != paragraph_appearance(child.get('attrs', {})):
                    raise ValueError('This Word paragraph deletion joins different formatting that Alder cannot yet retain in both review views. The original file has not been changed.')
                result[-1].setdefault('content', []).append({'type': 'revision_break', 'attrs': {**pending, 'rightType': child['type'], 'rightAttrs': deepcopy(child.get('attrs', {}))}})
                result[-1]['content'].extend(child.get('content', []))
            else:
                if pending:
                    identity = child.setdefault('attrs', {}).setdefault('blockId', 'block_' + uuid4().hex)
                    boundary_owner.setdefault('content', []).append({'type': 'revision_break', 'attrs': {**pending, 'nextId': identity}})
                result.append(child)
            pending = change
            boundary_owner = result[-1] if pending else None
        if pending:
            raise ValueError('A tracked paragraph boundary has no following paragraph. The original file has not been changed.')
        if 'content' in node: node['content'] = result
    walk(document)
    return document
