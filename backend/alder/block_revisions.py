"""Native Word insertion/deletion of a complete prose paragraph."""
from uuid import uuid4

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def write_word_block_changes(root,changes):
    from docx.oxml import OxmlElement
    next_id=max((int(n.get(f'{{{W}}}id')) for n in root.iter() if (n.get(f'{{{W}}}id') or '').isdigit()),default=0)+1
    for paragraph,change in changes:
        kind='ins' if change['kind']=='insertion' else 'del';stamp=change['stamp']
        properties=paragraph.get_or_add_pPr();run=properties.find(f'{{{W}}}rPr')
        if run is None:run=OxmlElement('w:rPr');properties.append(run)
        marker=OxmlElement('w:'+kind);wrapper=OxmlElement('w:'+kind)
        for node in (marker,wrapper):
            node.set(f'{{{W}}}id',str(next_id));next_id+=1;node.set(f'{{{W}}}author',stamp['author'])
            if stamp.get('date'):node.set(f'{{{W}}}date',stamp['date'])
        run.append(marker)
        for child in list(paragraph):
            if child is not properties:wrapper.append(child)
        if kind=='del':
            for text in wrapper.iter(f'{{{W}}}t'):text.tag=f'{{{W}}}delText'
        paragraph.append(wrapper)

def read_word_block_changes(root):
    result={}
    def ancillary(node):
        if node.tag.rsplit('}',1)[-1] in ('bookmarkStart','bookmarkEnd','proofErr','commentRangeStart','commentRangeEnd'):return True
        return node.tag==f'{{{W}}}r' and node.find(f'{{{W}}}commentReference') is not None and all(c.tag in (f'{{{W}}}rPr',f'{{{W}}}commentReference') for c in node)
    for paragraph in root.iter(f'{{{W}}}p'):
        properties=paragraph.find(f'{{{W}}}pPr');run=properties.find(f'{{{W}}}rPr') if properties is not None else None
        markers=[c for c in run if c.tag in (f'{{{W}}}ins',f'{{{W}}}del')] if run is not None else []
        if len(markers)!=1:continue
        marker=markers[0];kind=marker.tag.rsplit('}',1)[-1]
        wrappers=[c for c in paragraph if c.tag==marker.tag]
        # Word removes the empty content wrapper when resaving a newly added
        # list item. Its numbered paragraph mark still carries the whole item.
        empty_item=not wrappers and properties.find(f'{{{W}}}numPr') is not None
        if (not wrappers and not empty_item) or any(c is not properties and c not in wrappers and not ancillary(c) for c in paragraph):continue
        # A full paragraph's text and paragraph mark are one native change.
        authors={(n.get(f'{{{W}}}author',''),n.get(f'{{{W}}}date','')) for n in [marker,*wrappers]}
        if len(authors)!=1:continue
        if properties.find(f'{{{W}}}sectPr') is not None or properties.find(f'{{{W}}}pPrChange') is not None:continue
        unsupported={'ins','del','moveFrom','moveTo','rPrChange','drawing','pict','fldSimple','instrText','delInstrText','footnoteReference','endnoteReference'}
        if any(c.tag.rsplit('}',1)[-1] in unsupported for wrapper in wrappers for c in wrapper.iterdescendants()):continue
        author,date=authors.pop();identity='block_'+uuid4().hex
        result[paragraph]={'kind':'insertion' if kind=='ins' else 'deletion','stamp':{'id':'change_'+uuid4().hex,'author':author,'date':date},'originalId':identity}
        for wrapper in wrappers:
            for text in wrapper.iter(f'{{{W}}}delText'):text.tag=f'{{{W}}}t'
            for child in list(wrapper):wrapper.addprevious(child)
            paragraph.remove(wrapper)
        run.remove(marker)
    return result
