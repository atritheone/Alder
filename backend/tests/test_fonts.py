"""The font menu follows the current installation, including TTC families."""
import struct
import pytest
from alder import fonts


@pytest.fixture(autouse=True)
def isolate_native_fonts(monkeypatch):
    monkeypatch.setattr(fonts, "_windows_families", lambda: set())


def sfnt(names, offset=0, embedding=0):
    strings = b''
    records = b''
    for name_id, value in names.items():
        encoded = value.encode('utf-16-be')
        records += struct.pack('>6H', 3, 1, 0x409, name_id, len(encoded), len(strings))
        strings += encoded
    name = struct.pack('>3H', 0, len(names), 6 + len(records)) + records + strings
    header = struct.pack('>I4H', 0x10000, 2, 0, 0, 0)
    tables = struct.pack('>4sIII', b'name', 0, offset + 44, len(name))
    tables += struct.pack('>4sIII', b'OS/2', 0, offset + 44 + len(name), 10)
    return header + tables + name + b'\0' * 8 + struct.pack('>H', embedding)


def test_discovers_current_users_collection_and_refreshes(monkeypatch, tmp_path):
    first = tmp_path / 'personal.ttf'
    first.write_bytes(sfnt({1: 'Personal Family', 2: 'Regular'}))
    second = tmp_path / 'different-user.otf'
    second.write_bytes(sfnt({1: 'Another User Font', 2: 'Regular'}))
    collection = {first}
    monkeypatch.setattr(fonts, '_font_paths', lambda: collection)
    assert fonts.installed_families() == ['Personal Family']
    collection.clear()
    collection.add(second)
    assert fonts.installed_families() == ['Another User Font']
    second.write_bytes(sfnt({1: 'Replacement Family With New Name', 2: 'Regular'}))
    assert fonts.installed_families() == ['Replacement Family With New Name']


def test_collection_reads_every_face_and_prefers_typographic_name(monkeypatch, tmp_path):
    first = sfnt({1: 'Legacy Name', 16: 'Book Family', 17: 'Regular'}, offset=20)
    second = sfnt({1: 'Math Family', 2: 'Regular'}, offset=20 + len(first), embedding=2)
    path = tmp_path / 'book.ttc'
    path.write_bytes(b'ttcf' + struct.pack('>4I', 0x10000, 2, 20, 20 + len(first)) + first + second)
    monkeypatch.setattr(fonts, '_font_paths', lambda: {path})
    faces = fonts.installed_faces()
    assert [(f['family'], f['index']) for f in faces] == [('Book Family', 0), ('Legacy Name', 0), ('Math Family', 1)]
    assert fonts.register_pdf_font('Math Family', faces) is None
    assert fonts.installed_families() == ['Book Family', 'Legacy Name', 'Math Family']


def test_broken_fonts_do_not_break_inventory(monkeypatch, tmp_path):
    broken = tmp_path / 'broken.ttf'
    broken.write_bytes(b'\0\1\0\0')
    valid = tmp_path / 'valid.ttf'
    valid.write_bytes(sfnt({1: 'Readable', 2: 'Regular'}))
    monkeypatch.setattr(fonts, '_font_paths', lambda: {broken, valid, tmp_path / 'missing.ttf'})
    assert fonts.installed_families() == ['Readable']


def test_native_named_instances_appear_without_static_font_files(monkeypatch):
    monkeypatch.setattr(fonts, '_windows_families', lambda: {'Variable Font Light', 'Variable Font Semibold'})
    monkeypatch.setattr(fonts, '_font_paths', lambda: set())
    assert fonts.installed_families() == ['Variable Font Light', 'Variable Font Semibold']
