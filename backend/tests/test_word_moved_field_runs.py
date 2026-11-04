import pytest
from lxml import etree
from alder.tracked_block_moves import W, join_updated_field_moves


@pytest.mark.parametrize('mutation',[None,'authored_deletion','foreign_author','ordinary_field_without_result','unknown_marker'])
def test_word_empty_code_deletion_and_resultless_index_field_are_bounded(mutation):
    stamp='w:author="Reviewer" w:date="2026-11-04T00:00:00Z"'
    paragraph=etree.fromstring(f'''<w:p xmlns:w="{W}">
      <w:moveFrom {stamp}><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF Target </w:instrText></w:r></w:moveFrom>
      <w:del {stamp}/>
      <w:moveFrom {stamp}><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Heading</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> XE "Trees:Alder" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
      </w:moveFrom></w:p>''')
    deletion=paragraph.find(f'{{{W}}}del')
    if mutation=='authored_deletion':etree.SubElement(etree.SubElement(deletion,f'{{{W}}}r'),f'{{{W}}}delText').text='Authored deletion'
    elif mutation=='foreign_author':deletion.set(f'{{{W}}}author','Someone else')
    elif mutation in ('ordinary_field_without_result','unknown_marker'):
        list(paragraph.iter(f'{{{W}}}instrText'))[-1].text='REF Other' if mutation=='ordinary_field_without_result' else 'UNKNOWN "Trees"'
    def fail():raise ValueError('Unsupported move')
    if mutation:
        with pytest.raises(ValueError,match='Unsupported move'):join_updated_field_moves(paragraph,'moveFrom',paragraph[0],fail)
    else:
        join_updated_field_moves(paragraph,'moveFrom',paragraph[0],fail)
        assert len(paragraph)==1 and paragraph[0].tag==f'{{{W}}}moveFrom'
        assert ''.join(paragraph.itertext(f'{{{W}}}t'))=='Heading'
        assert len(list(paragraph.iter(f'{{{W}}}instrText')))==2
