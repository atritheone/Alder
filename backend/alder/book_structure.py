"""Publication semantics, independent of prose and physical page numbering.

Terms follow https://www.w3.org/TR/epub-ssv-11/. Existing custom chapter roles
remain stored, while portable semantics fall back to ordinary chapters.
"""
import html

FRONT = {'titlepage', 'copyright-page', 'dedication', 'foreword', 'preface', 'toc', 'frontmatter'}
BODY = {'introduction', 'part', 'chapter', 'epilogue', 'bodymatter'}
BACK = {'afterword', 'appendix', 'acknowledgments', 'bibliography', 'glossary', 'index', 'backmatter'}
ROLES = FRONT | BODY | BACK
MATTERS = {'frontmatter', 'bodymatter', 'backmatter'}

def matter(chapter):
    if chapter.get('matter') in MATTERS: return chapter['matter']
    role = chapter.get('role', 'chapter')
    return 'frontmatter' if role in FRONT else 'backmatter' if role in BACK else 'bodymatter'

def validate_structure(chapter):
    role = chapter.setdefault('role', 'chapter')
    if not isinstance(role, str) or not 1 <= len(role) <= 80:
        raise ValueError('A chapter type requires 1–80 characters.')
    division = chapter.get('matter')
    if division is not None and (not isinstance(division, str) or division not in MATTERS):
        raise ValueError('Book division must be front matter, body or back matter.')
    if 'showTitle' in chapter and not isinstance(chapter['showTitle'], bool):
        raise ValueError('Chapter title visibility must be true or false.')

def metadata(section):
    return {'title':section.get('navigationTitle', section.get('title','')),
            'role':section.get('role','chapter'), 'matter':matter(section),
            'showTitle':section.get('showTitle',True),'book':section.get('bookStructure',False)}

def html_attributes(section):
    import json
    return ' data-alder-chapter="' + html.escape(json.dumps(metadata(section),ensure_ascii=False,separators=(',',':')),quote=True) + '"'

def epub_role(section):
    role=section.get('role','chapter')
    return role if role in ROLES else 'chapter'
