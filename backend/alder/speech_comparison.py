"""Conservative English transcript equivalences, versioned with speech checks.

Only explicit spelling pairs, compounds, unambiguous contractions, integers, ordinals and numeric ranges are folded. Homophones,
possessives, currency units, decimal separators, and unsupported forms remain
available to the comparison instead of being guessed.
"""
import re
import unicodedata

VERSION = 9
SPELLINGS = dict(zip(
    'colour colours coloured favour favours favourite favourites honour honours labour neighbour neighbours centre centres theatre theatres metre metres litre litres organise organised organising organisation recognise recognised recognise'.split(),
    'color colors colored favor favors favorite favorites honor honors labor neighbor neighbors center centers theater theaters meter meters liter liters organize organized organizing organization recognize recognized recognize'.split()))
SPELLINGS.update({'café': 'cafe', 'cafés': 'cafes', 'labelled': 'labeled', 'labelling': 'labeling', 'travelled': 'traveled', 'travelling': 'traveling', 'cancelled': 'canceled', 'cancelling': 'canceling', 'curtsey': 'curtsy', 'curtseys': 'curtsies', 'curtseyed': 'curtsied', 'curtseying': 'curtsying'})
SPELLINGS.update({'recognisable':'recognizable', 'recognisably':'recognizably', 'unrecognisable':'unrecognizable', 'unrecognisably':'unrecognizably'})
SPELLINGS.update({'colourful':'colorful', 'colourless':'colorless', 'archaeologist':'archeologist', 'archaeologists':'archeologists', 'archaeology':'archeology', 'crème':'creme', 'brûlée':'brulee'})
# Explicit compounds may be transcribed with a space or hyphen without changing speech.
COMPOUNDS = {'cannot': ['can', 'not'], 'armchair': ['arm', 'chair'], 'armchairs': ['arm', 'chairs'], 'bookshelf': ['book', 'shelf'], 'bookshelves': ['book', 'shelves'], 'waistcoat': ['waist', 'coat'], 'waistcoats': ['waist', 'coats'], 'downstairs': ['down', 'stairs'], 'upstairs': ['up', 'stairs'], 'tonight': ['to', 'night'], 'today': ['to', 'day'], 'tomorrow': ['to', 'morrow']}
# En dashes denote ranges. ASCII hyphens are unambiguous here only for
# four-digit years; keep negative numbers and subtraction distinct.
NUMBER_RANGE = re.compile(r"(?<![\w.])(?:\d+(?:\.\d+)?[ \t]*–[ \t]*\d+(?:\.\d+)?|\d{4}-\d{4})(?!\w|\.\d)")


def spoken_range(match):
    return re.sub(r"[ \t]*[–-][ \t]*", " to ", match.group())


SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def integer_words(n):
    if n < 20: return [SMALL[n]]
    if n < 100: return [TENS[n // 10]] + (integer_words(n % 10) if n % 10 else [])
    if n < 1000: return [SMALL[n // 100], 'hundred'] + (integer_words(n % 100) if n % 100 else [])
    return integer_words(n // 1000) + ['thousand'] + (integer_words(n % 1000) if n % 1000 else [])


ORDINAL_ENDINGS = dict(zip(
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand'.split(),
    'zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth'.split()))


def ordinal_words(match):
    number = int(match.group(1))
    suffix = 'th' if 10 <= number % 100 <= 20 else {1:'st', 2:'nd', 3:'rd'}.get(number % 10, 'th')
    if match.group(2) != suffix:
        return match.group()  # Do not reinterpret malformed identifiers.
    words = integer_words(number)
    words[-1] = ORDINAL_ENDINGS[words[-1]]
    return ' '.join(words)


def expand_contraction(word):
    normal = word.replace('’', "'")
    lower = normal.lower()
    if lower == "ain't":
        return word  # Could mean am/is/are/has/have not.
    special = {"can't": 'can not', "won't": 'will not', "shan't": 'shall not', "i'm": 'I am'}
    if lower in special:
        return special[lower]
    for suffix, expansion in (("'ll", ' will'), ("'re", ' are'), ("'ve", ' have'), ("n't", ' not')):
        if lower.endswith(suffix) and len(normal) > len(suffix):
            return expand_contraction(normal[:-len(suffix)]) + expansion
    # 's and 'd are ambiguous (possessive/is/has and would/had).
    return word


def canonical_tokens(value):
    value = unicodedata.normalize('NFKC', value).casefold().replace('’', "'")
    # English ASR often omits accents in loanwords and names. Compare their
    # base spelling; retain accented source/synthesis text and never infer a
    # different name (Zoe/Zoey) or discard ordinary letters. This is a content
    # check, not evidence that the intended pronunciation or stress is correct.
    def base_spelling(char):
        decomposed = unicodedata.normalize('NFD', char)
        if decomposed[0].isascii() and decomposed[0].isalpha() and all(unicodedata.combining(c) for c in decomposed[1:]):
            return decomposed[0]
        return char
    value = ''.join(base_spelling(c) for c in value)
    # Keep the meaning of currency/symbols and decimal points. Do not silently
    # turn $12.50 into the integers 12 and 50, or -5 into positive five.
    value = re.sub(r"\b(0|[1-9]\d{0,3})(st|nd|rd|th)\b", ordinal_words, value)
    value = NUMBER_RANGE.sub(spoken_range, value)
    value = re.sub(r'(?<=\d),(?=\d{3}(?:\D|$))', '', value)
    value = re.sub(r'(?<=\d)\.(?=\d)', ' point ', value)
    value = re.sub(r'-(?=\d)', ' minus ', value)
    value = value.replace('%', ' percent ').replace('$', ' dollar ').replace('£', ' pound ').replace('€', ' euro ')
    tokens = re.findall(r"[^\W_]+(?:'[^\W_]+)*", value)
    result = []
    for token in tokens:
        expanded = expand_contraction(token)
        if expanded != token:
            result.extend(canonical_tokens(expanded))
        elif token.isascii() and token.isdigit() and len(token) <= 4 and (token == '0' or not token.startswith('0')):
            result.extend(integer_words(int(token)))
        else:
            result.extend(COMPOUNDS.get(token, [SPELLINGS.get(token, token)]))
    # Optional conjunction in spoken cardinal integers only.
    return [t for i,t in enumerate(result) if not (t == 'and' and i and result[i-1] in {'hundred', 'thousand'} and i+1 < len(result) and result[i+1] in SMALL + TENS + list(ORDINAL_ENDINGS.values()))]
