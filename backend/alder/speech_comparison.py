"""Conservative English transcript equivalences, versioned with speech checks.

Only explicit spelling pairs and unambiguous integers are folded. Homophones,
possessives, currency units, decimal separators, and unsupported forms remain
available to the comparison instead of being guessed.
"""
import re
import unicodedata

VERSION = 2
SPELLINGS = dict(zip(
    'colour colours coloured favour favours favourite favourites honour honours labour neighbour neighbours centre centres theatre theatres metre metres litre litres organise organised organising organisation recognise recognised recognise'.split(),
    'color colors colored favor favors favorite favorites honor honors labor neighbor neighbors center centers theater theaters meter meters liter liters organize organized organizing organization recognize recognized recognize'.split()))
SPELLINGS.update({'café': 'cafe', 'cafés': 'cafes'})
SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def integer_words(n):
    if n < 20: return [SMALL[n]]
    if n < 100: return [TENS[n // 10]] + (integer_words(n % 10) if n % 10 else [])
    if n < 1000: return [SMALL[n // 100], 'hundred'] + (integer_words(n % 100) if n % 100 else [])
    return integer_words(n // 1000) + ['thousand'] + (integer_words(n % 1000) if n % 1000 else [])


def canonical_tokens(value):
    value = unicodedata.normalize('NFKC', value).casefold().replace('’', "'")
    # Keep the meaning of currency/symbols and decimal points. Do not silently
    # turn $12.50 into the integers 12 and 50, or -5 into positive five.
    value = re.sub(r'(?<=\d),(?=\d{3}(?:\D|$))', '', value)
    value = re.sub(r'(?<=\d)\.(?=\d)', ' point ', value)
    value = re.sub(r'-(?=\d)', ' minus ', value)
    value = value.replace('%', ' percent ').replace('$', ' dollar ').replace('£', ' pound ').replace('€', ' euro ')
    tokens = re.findall(r"[^\W_]+(?:'[^\W_]+)*", value)
    result = []
    for token in tokens:
        if token.isascii() and token.isdigit() and len(token) <= 4 and (token == '0' or not token.startswith('0')):
            result.extend(integer_words(int(token)))
        else:
            result.append(SPELLINGS.get(token, token))
    # Optional conjunction in spoken cardinal integers only.
    return [t for i,t in enumerate(result) if not (t == 'and' and i and result[i-1] in {'hundred', 'thousand'} and i+1 < len(result) and result[i+1] in SMALL + TENS)]
