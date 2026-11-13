import codecs
import unittest
from alder.plain_text_file import decode_file, encode_file


class PlainTextFileTests(unittest.TestCase):
    def test_byte_exact_round_trip(self):
        for raw in (b'', b'a\r\nb\nc\r\r\n', b' a\t  \r\n\r\n', b'no newline',
                    codecs.BOM_UTF8 + 'café 😀\r\n'.encode(),
                    codecs.BOM_UTF16_LE + '字\r\n'.encode('utf-16-le'),
                    codecs.BOM_UTF16_BE + '字\n'.encode('utf-16-be'), b'caf\xe9\r\n'):
            with self.subTest(raw=raw):
                text, meta = decode_file(raw)
                self.assertEqual(encode_file(text, meta), raw)

    def test_insert_preserves_surviving_endings(self):
        _, meta = decode_file(b'a\r\nb\nc\r')
        self.assertEqual(encode_file('a\nb\nx\nc\n', meta), b'a\r\nb\nx\r\nc\r')

    def test_conversion_is_explicit(self):
        text, meta = decode_file(b'a\r\nb\n')
        meta.update(eol='\n', convertEol=True)
        self.assertEqual(encode_file(text, meta), b'a\nb\n')

    def test_word_edit_keeps_that_lines_existing_ending(self):
        text, meta = decode_file(b'first\r\nsecond\nthird\r\n')
        self.assertEqual(encode_file(text.replace('second','changed'), meta), b'first\r\nchanged\nthird\r\n')

    def test_unrepresentable_character_refuses_lossy_save(self):
        _, meta = decode_file(b'caf\xe9')
        with self.assertRaisesRegex(ValueError, 'UTF-8'):
            encode_file('😀', meta)

    def test_malformed_utf16_refused(self):
        with self.assertRaises(ValueError):
            decode_file(codecs.BOM_UTF16_LE + b'x')

    def test_malformed_saved_format_metadata_is_refused(self):
        for metadata in (None, {'originalText': {}}, {'endings': '\n'}, {'endings': ['invalid']}, {'bom': 'yes'}, {'version': 999}):
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                encode_file('retained wording', metadata)

    def test_actual_import_workspace_and_export_preserve_bytes(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from alder.document_opening import imported_project
        from alder.publishing import import_document, build_export
        from alder.store import Store
        for raw in (b'a\r\nb\nc\r\r\n', codecs.BOM_UTF8 + 'café 😀\r\n'.encode(),
                    codecs.BOM_UTF16_BE + '字\r\n'.encode('utf-16-be'), b'caf\xe9\r\n', b''):
            with self.subTest(raw=raw), TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'source.txt'
                source.write_bytes(raw)
                project = imported_project(import_document(source), source.name, Store(root / 'state'))
                result = build_export(project, 'txt', root / 'exports')
                self.assertEqual(Path(result['path']).read_bytes(), raw)
