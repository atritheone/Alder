"""Logical page labels, independent of physical sheet indices."""
NUMBER_FORMATS = ('decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter')


def validate_numbering(start=None, format=None):
    if start is not None and (type(start) is not int or not 1 <= start <= 9999):
        raise ValueError('Starting page number must be a whole number from 1 to 9999.')
    if format is not None and format not in NUMBER_FORMATS:
        raise ValueError('Unsupported page-number format.')


def format_page_number(number, format='decimal'):
    if format in ('lowerLetter', 'upperLetter') and number > 0:
        text = chr(65 + (number - 1) % 26) * ((number + 25) // 26)
        return text.lower() if format == 'lowerLetter' else text
    if format in ('lowerRoman', 'upperRoman') and number > 0:
        text = ''
        for value, symbol in ((1000,'M'),(900,'CM'),(500,'D'),(400,'CD'),(100,'C'),(90,'XC'),(50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')):
            count, number = divmod(number, value)
            text += symbol * count
        return text.lower() if format == 'lowerRoman' else text
    return str(number)


def section_numbering(next_number, kind, restart=None):
    parity = {'oddPage': 1, 'evenPage': 0}.get(kind)
    number = next_number if restart is None else restart
    advance = int(parity is not None and number % 2 != parity)
    return number + advance, restart is None and bool(advance)


def read_docx_numbering(section, warnings):
    from docx.oxml.ns import qn
    numbering = section._sectPr.find(qn('w:pgNumType'))
    if numbering is None:
        return {}
    result = {}
    if numbering.get(qn('w:start')) is not None:
        try:
            result['numberingStart'] = int(numbering.get(qn('w:start')))
            validate_numbering(result['numberingStart'])
        except ValueError:
            result['numberingStart'] = 1
            warnings.append('DOCX starting page number is outside the supported range and was reset to 1.')
    # An omitted format on pgNumType means decimal, not inherit.
    format = numbering.get(qn('w:fmt'), 'decimal')
    result['numberingFormat'] = format if format in NUMBER_FORMATS else 'decimal'
    if format not in NUMBER_FORMATS or any(numbering.get(qn('w:' + name)) for name in ('chapStyle', 'chapSep')):
        warnings.append('DOCX chapter-prefixed or unsupported page-number formats are converted to ordinary page labels.')
    return result
