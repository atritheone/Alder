"""The ordinary editable list-marker subset, shared by publication formats."""
NUMBER_FORMATS = {'decimal': 'decimal', 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman'}
BULLETS = {'disc': '\u2022', 'circle': '\u25cb', 'square': '\u25aa'}


def list_marker(number, style='decimal'):
    if style in BULLETS:
        return BULLETS[style]
    if style in ('lower-alpha', 'upper-alpha') and number > 0:
        result = ''
        while number:
            number, digit = divmod(number - 1, 26)
            result = chr(65 + digit) + result
        return result.lower() if style == 'lower-alpha' else result
    if style in ('lower-roman', 'upper-roman') and 0 < number < 4000:
        result = ''
        for value, symbol in ((1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')):
            count, number = divmod(number, value)
            result += symbol * count
        return result.lower() if style == 'lower-roman' else result
    return str(number)
