"""Offline discretionary breaks. Returned offsets are UTF-16, never authored text."""
from functools import lru_cache
import re
import unicodedata
import pyphen


def valid_language(value):
    return isinstance(value,str) and len(value)<=40 and re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*',value) is not None


def validate_typography(attrs):
    if attrs.get('textDirection') not in (None,'ltr','rtl'):raise ValueError('Paragraph direction must be left to right, right to left or inherited.')
    if attrs.get('hyphenation') is not None and type(attrs['hyphenation']) is not bool:raise ValueError('Hyphenation must be on, off or inherited.')
    if attrs.get('textLanguage') is not None and not valid_language(attrs['textLanguage']):raise ValueError('Use a language tag such as en-GB, de or fr for the paragraph language.')


@lru_cache(maxsize=32)
def dictionary(language):
    name=pyphen.language_fallback(language.replace('-','_'))
    if not name:raise ValueError(f'No local hyphenation dictionary is available for {language}. Choose another paragraph language or turn hyphenation off.')
    return pyphen.Pyphen(lang=name,left=2,right=2,cache=False)


@lru_cache(maxsize=20000)
def word_breaks(language,word):
    # Alternative-spelling dictionary breaks would change authored wording.
    # Leave those words unbroken until an explicit representation supports them.
    points=dictionary(language).positions(word)
    return tuple(len(word[:int(point)].encode('utf-16-le'))//2 for point in points if not getattr(point,'data',None))


def break_words(payload):
    language=payload.get('language','en');words=payload.get('words')
    if not valid_language(language) or not isinstance(words,list) or len(words)>512 or any(not isinstance(word,str) or not 1<=len(word)<=80 or not all(c.isalpha() or unicodedata.category(c).startswith('M') for c in word) for word in words):raise ValueError('Hyphenation needs a language and up to 512 words of at most 80 letters.')
    dictionary(language)
    return {'language':language,'breaks':[list(word_breaks(language,word)) for word in words]}


def write_properties(props,attrs):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    ppr=props._element.get_or_add_pPr()
    if attrs.get('textDirection') is not None:
        element=ppr.find(qn('w:bidi'))
        if element is None:element=OxmlElement('w:bidi');ppr.append(element)
        element.set(qn('w:val'),'1' if attrs['textDirection']=='rtl' else '0')
    if attrs.get('hyphenation') is not None:
        element=ppr.find(qn('w:suppressAutoHyphens'))
        if element is None:element=OxmlElement('w:suppressAutoHyphens');ppr.append(element)
        element.set(qn('w:val'),'0' if attrs['hyphenation'] else '1')
    if attrs.get('textLanguage'):
        parent=props._element if props._element.tag==qn('w:style') else ppr
        rpr=parent.find(qn('w:rPr'))
        if rpr is None:rpr=OxmlElement('w:rPr');parent.append(rpr)
        element=rpr.find(qn('w:lang'))
        if element is None:element=OxmlElement('w:lang');rpr.append(element)
        for key in ('val','eastAsia','bidi'):element.set(qn('w:'+key),attrs['textLanguage'])


def read_properties(props):
    from docx.oxml.ns import qn
    result={};ppr=props._element.pPr
    direction=ppr.find(qn('w:bidi')) if ppr is not None else None
    if direction is not None:result['textDirection']='ltr' if direction.get(qn('w:val'),'1') in ('0','false','off') else 'rtl'
    element=ppr.find(qn('w:suppressAutoHyphens')) if ppr is not None else None
    if element is not None:result['hyphenation']=element.get(qn('w:val'),'1') in ('0','false','off')
    parent=props._element if props._element.tag==qn('w:style') else ppr
    if parent is None:return result
    element=parent.find('./'+qn('w:rPr')+'/'+qn('w:lang'))
    if element is not None and valid_language(element.get(qn('w:val'))):result['textLanguage']=element.get(qn('w:val'))
    return result


def write_run_language(paragraph,language):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    for run in paragraph.runs:
        rpr=run._r.get_or_add_rPr();element=rpr.find(qn('w:lang'))
        if element is None:element=OxmlElement('w:lang');rpr.append(element)
        for key in ('val','eastAsia','bidi'):element.set(qn('w:'+key),language)
