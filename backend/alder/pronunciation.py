"""REX dictionaries, friendly rule controls and source-preserving substitutions.

Balabolka's installed English help (REX.htm/correct.htm) defines @ for case,
first unescaped = as separator, $N captures, and sequential replacement.
"""
from functools import lru_cache
import re
import json
import uuid
import regex

MODES = {'whole', 'start', 'end', 'anywhere', 'pattern'}


def pattern_text(entry):
    if entry.get('patternParts') is not None:
        return emit_parts(entry['patternParts'])
    word = entry['word']
    mode = entry.get('matchMode', 'pattern' if entry.get('regex') else 'whole')
    if mode == 'pattern':
        return word
    literal = re.escape(word)
    # REX word boundaries are distinct from matching at the start/end of input.
    return (r'\b' if mode in {'whole', 'start'} else '') + literal + (r'\b' if mode in {'whole', 'end'} else '')


def emit_parts(parts):
    result = []
    for p in parts:
        kind = p['kind']
        if kind == 'text': value = re.escape(p.get('value', ''))
        elif kind == 'any': value = '.'
        elif kind == 'digit': value = r'\d'
        elif kind == 'space': value = r'\s'
        elif kind == 'lineBreak': value = r'\n'
        elif kind == 'tab': value = r'\t'
        elif kind == 'word': value = r'\w'
        elif kind == 'notDigit': value = r'\D'
        elif kind == 'notSpace': value = r'\S'
        elif kind == 'notWord': value = r'\W'
        elif kind == 'boundary': value = r'\b'
        elif kind == 'notBoundary': value = r'\B'
        elif kind == 'begin': value = '^'
        elif kind == 'finish': value = '$'
        elif kind == 'characters': value = '[' + ('^' if p.get('negate') else '') + re.escape(p.get('value', '')) + ']'
        elif kind == 'range': value = '[' + ('^' if p.get('negate') else '') + re.escape(p['from']) + '-' + re.escape(p['to']) + ']'
        elif kind == 'group': value = '(' + ('' if p.get('capture', True) else '?:') + emit_parts(p.get('children', [])) + ')'
        elif kind == 'either': value = '(?:' + '|'.join(emit_parts(a) for a in p['options']) + ')'
        elif kind == 'except': value = '(?!(?:' + '|'.join(emit_parts(a) for a in p['options']) + r'))[\s\S]'
        elif kind == 'repeat':
            minimum = int(p.get('min', 0)); maximum = p.get('max')
            if minimum < 0 or (maximum is not None and int(maximum) < minimum):
                raise ValueError('Repetition counts must be nonnegative and the maximum must be at least the minimum.')
            value = '(?:' + emit_parts(p['children']) + '){' + str(minimum) + ',' + ('' if maximum is None else str(int(maximum))) + '}' + ('' if p.get('greedy', True) else '?')
        elif kind == 'reference': value = '\\' + str(int(p['group']))
        elif kind in {'followed', 'notFollowed', 'preceded', 'notPreceded'}:
            value = {'followed':'(?=', 'notFollowed':'(?!', 'preceded':'(?<=', 'notPreceded':'(?<!'}[kind] + emit_parts(p['children']) + ')'
        else: raise ValueError('This pattern part is not supported: ' + str(kind))
        result.append(value)
    return ''.join(result)


def explain_pattern(pattern):
    """Translate the documented regex operators into editable semantic parts."""
    from re import _parser, _constants as c
    def walk(items):
        out = []
        for op, arg in items:
            if op == c.LITERAL:
                if arg in (10,9):
                    out.append({'kind':'lineBreak' if arg==10 else 'tab'}); continue
                if out and out[-1]['kind'] == 'text': out[-1]['value'] += chr(arg)
                else: out.append({'kind':'text', 'value':chr(arg)})
            elif op == c.NOT_LITERAL: out.append({'kind':'characters','value':chr(arg),'negate':True})
            elif op == c.ANY: out.append({'kind':'any'})
            elif op == c.SUBPATTERN:
                group, add, remove, children = arg
                if add or remove: raise ValueError('Inline option changes are not supported by the visual editor.')
                out.append({'kind':'group','capture':bool(group),'children':walk(children)})
            elif op == c.BRANCH: out.append({'kind':'either','options':[walk(a) for a in arg[1]]})
            elif op in (c.MAX_REPEAT, c.MIN_REPEAT):
                lo, hi, children = arg
                out.append({'kind':'repeat','min':lo,'max':None if hi == c.MAXREPEAT else hi,'greedy':op == c.MAX_REPEAT,'children':walk(children)})
            elif op == c.GROUPREF: out.append({'kind':'reference','group':arg})
            elif op in (c.ASSERT, c.ASSERT_NOT):
                direction, children = arg
                out.append({'kind':('preceded' if direction < 0 else 'followed') if op == c.ASSERT else ('notPreceded' if direction < 0 else 'notFollowed'), 'children':walk(children)})
            elif op == c.AT:
                names = {c.AT_BEGINNING:'begin',c.AT_BEGINNING_STRING:'begin',c.AT_END:'finish',c.AT_END_STRING:'finish',c.AT_BOUNDARY:'boundary',c.AT_NON_BOUNDARY:'notBoundary'}
                if arg not in names: raise ValueError('Unsupported position condition.')
                out.append({'kind':names[arg]})
            elif op == c.IN:
                negate = arg[0][0] == c.NEGATE
                values = arg[1:] if negate else arg
                names = {c.CATEGORY_DIGIT:'digit',c.CATEGORY_NOT_DIGIT:'notDigit',c.CATEGORY_SPACE:'space',c.CATEGORY_NOT_SPACE:'notSpace',c.CATEGORY_WORD:'word',c.CATEGORY_NOT_WORD:'notWord'}
                if len(values)==1 and values[0][0] == c.CATEGORY and not negate:
                    out.append({'kind':names[values[0][1]]})
                elif all(a == c.LITERAL for a,b in values):
                    out.append({'kind':'characters','value':''.join(chr(b) for a,b in values),'negate':negate})
                elif len(values)==1 and values[0][0] == c.RANGE:
                    out.append({'kind':'range','from':chr(values[0][1][0]),'to':chr(values[0][1][1]),'negate':negate})
                else:
                    options = []
                    for a,b in values:
                        if a == c.LITERAL: options.append([{'kind':'text','value':chr(b)}])
                        elif a == c.RANGE: options.append([{'kind':'range','from':chr(b[0]),'to':chr(b[1])}])
                        elif a == c.CATEGORY: options.append([{'kind':names[b]}])
                    out.append({'kind':'except' if negate else 'either','options':options})
            else: raise ValueError('This expression requires an advanced pattern: ' + str(op))
        return out
    parsed = _parser.parse(pattern, re.ASCII)
    if parsed.state.flags & (re.I | re.M | re.S | re.X):
        raise ValueError('Inline option changes need an advanced expression.')
    return walk(parsed)


def replacement_parts(value):
    parts, mode, next_case = [], 'keep', None
    i = 0
    def add(kind, **fields):
        nonlocal next_case
        part = {'kind':kind, **fields, 'case':next_case or mode}
        if kind == 'text' and parts and parts[-1]['kind']=='text' and parts[-1]['case']==part['case'] and next_case is None:
            parts[-1]['text'] += fields['text']
        else: parts.append(part)
        next_case = None
    while i < len(value):
        if value[i] == '$' and i+1 < len(value) and value[i+1].isdigit():
            m = re.match(r'\d+', value[i+1:]); add('group', group=int(m.group())); i += 1+len(m.group()); continue
        if value[i] == '\\' and i+1 < len(value):
            char = value[i+1]; i += 2
            if char in 'ULE': mode = {'U':'upper','L':'lower','E':'keep'}[char]; continue
            if char in 'ul': next_case = {'u':'upperFirst','l':'lowerFirst'}[char]; continue
            add('text', text={'n':'\n','r':'\r','t':'\t','f':'\f','v':'\v'}.get(char,char)); continue
        add('text', text=value[i]); i += 1
    return parts


def emit_replacement(parts):
    result = []
    for part in parts:
        mode = part.get('case','keep')
        prefix = {'keep':'','upper':r'\U','lower':r'\L','upperFirst':r'\u','lowerFirst':r'\l'}[mode]
        value = '$' + str(part['group']) if part['kind']=='group' else part.get('text','').replace('\\',r'\\').replace('$',r'\$').replace('=',r'\=').replace('\n',r'\n').replace('\r',r'\r').replace('\t',r'\t')
        result.append(prefix + value + (r'\E' if mode in {'upper','lower'} else ''))
    return ''.join(result)


def _pattern_decode(pattern):
    pattern = re.sub(r'\\x\{([0-9a-fA-F]{4})\}', lambda m: re.escape(chr(int(m[1],16))), pattern).replace(r'\=', '=')
    groups = len(re.findall(r'(?<!\\)\((?!\?)', pattern))
    def octal(match):
        value = match[1]
        if value[0] != '0' and int(value) <= groups: return match.group()
        prefix = value if int(value,8) <= 255 else value[:2]
        return re.escape(chr(int(prefix,8))) + value[len(prefix):]
    return re.sub(r'(?<!\\)\\([0-7]{1,3})', octal, pattern)


@lru_cache(maxsize=8192)
def compile_pattern(pattern, sensitive, rex=True):
    return regex.compile(_pattern_decode(pattern), (regex.ASCII if rex else 0) | (0 if sensitive else regex.IGNORECASE))


def validate_rule(entry):
    if not isinstance(entry.get('word'),str) or not entry['word'].strip() or not isinstance(entry.get('spoken'),str):
        raise ValueError('Enter the text to match and the spoken replacement.')
    if entry.get('matchMode','whole') not in MODES: raise ValueError('Choose a valid matching mode.')
    if entry.get('voiceId') is not None and not isinstance(entry['voiceId'],str): raise ValueError('Choose a voice or All Voices.')
    for key in ('enabled','caseSensitive'):
        if key in entry and not isinstance(entry[key],bool): raise ValueError(key + ' must be on or off.')
    try: pattern = compile_pattern(pattern_text(entry), entry.get('caseSensitive',False), entry.get('syntax')=='rex')
    except regex.error as exc: raise ValueError('Invalid matching pattern: ' + str(exc)) from exc
    parts = entry.get('replacementParts')
    if parts is not None:
        emit_replacement(parts)
        if any(p['kind']=='group' and not 0 <= int(p['group']) <= pattern.groups for p in parts):
            raise ValueError('The replacement refers to a captured part that does not exist.')
    if len(pattern_text(entry)) > 4000 or len(entry['spoken']) > 10000: raise ValueError('This pronunciation rule is too long.')
    return entry


def import_rex(data, name):
    if data.startswith((b'\xff\xfe',b'\xfe\xff')): text = data.decode('utf-16')
    else:
        try: text = data.decode('utf-8-sig')
        except UnicodeDecodeError: text = data.decode('cp1252')
    rules, errors = [], []
    voice_id = None
    for number, line in enumerate(text.splitlines(),1):
        if line.startswith('# Alder Voice: '):
            try: voice_id = json.loads(line[len('# Alder Voice: '):])
            except ValueError: voice_id = None
            continue
        enabled = not line.startswith('# Alder Disabled: ')
        if not enabled: line = line[len('# Alder Disabled: '):]
        if not line.strip() or line.lstrip().startswith('#'): continue
        try:
            split = next((m.start() for m in re.finditer('=',line) if len(re.search(r'\\*$',line[:m.start()]).group()) % 2 == 0),None)
            if split is None: raise ValueError('Missing replacement separator.')
            pattern, spoken = line[:split], line[split+1:]
            sensitive = pattern.startswith('@'); pattern = pattern[1:] if sensitive else pattern
            compiled = compile_pattern(pattern,sensitive)
            entry = {'id':uuid.uuid4().hex,'word':pattern,'spoken':spoken,'caseSensitive':sensitive,'voiceId':voice_id,'enabled':enabled,'syntax':'rex','matchMode':'pattern','regex':True,'dictionary':name,'rexOriginal':line}
            parts = replacement_parts(spoken)
            if all(p['kind']=='text' and p['case']=='keep' for p in parts): entry['spoken']=''.join(p['text'] for p in parts)
            else: entry['replacementParts']=parts
            tree = explain_pattern(_pattern_decode(pattern))
            # Remove capture wrappers only when the replacement does not use captures.
            simple = tree
            while len(simple)==1 and simple[0]['kind']=='group': simple=simple[0]['children']
            start = bool(simple and simple[0]['kind']=='boundary'); end = bool(simple and simple[-1]['kind']=='boundary')
            core = simple[1:] if start else simple
            core = core[:-1] if end else core
            while len(core)==1 and core[0]['kind']=='group': core=core[0]['children']
            if core and all(p['kind']=='text' for p in core) and not entry.get('replacementParts'):
                entry.update(word=''.join(p['value'] for p in core),matchMode='whole' if start and end else 'start' if start else 'end' if end else 'anywhere',regex=False)
            else: entry['patternParts']=tree
            validate_rule(entry)
            rules.append(entry)
            voice_id = None
        except (ValueError,regex.error,re.error,KeyError) as exc:
            errors.append({'line':number,'message':str(exc),'source':line})
            voice_id = None
    if len(rules)>10000: raise ValueError('Import at most 10,000 pronunciation rules at a time.')
    return {'rules':rules,'errors':errors,'name':name}


def export_rex(entries):
    lines = []
    for entry in entries:
        validate_rule(entry)
        pattern = pattern_text(entry).replace('=',r'\=').replace('\n',r'\n').replace('\r',r'\r')
        if pattern.startswith(('#','@')): pattern='\\'+pattern
        parts = entry.get('replacementParts')
        if parts is None and entry.get('regex') and entry.get('syntax') != 'rex':
            parts = replacement_parts(re.sub(r'\\(?:g<(\d+)>|(\d+))', lambda m: '$'+(m[1] or m[2]), entry['spoken']))
        replacement = emit_replacement(parts if parts is not None else [{'kind':'text','text':entry['spoken']}])
        if entry.get('voiceId'): lines.append('# Alder Voice: '+json.dumps(entry['voiceId']))
        lines.append(('' if entry.get('enabled',True) else '# Alder Disabled: ')+('@' if entry.get('caseSensitive') else '')+pattern+'='+replacement)
    return ('\ufeff'+'\r\n'.join(lines)+'\r\n').encode('utf-8')


def render_replacement(entry, match):
    parts = entry.get('replacementParts')
    if parts is None: return entry['spoken']
    output = []
    for part in parts:
        value = (match.group(int(part['group'])) or '') if part['kind']=='group' else part.get('text','')
        mode = part.get('case','keep')
        if mode=='upper': value=value.upper()
        elif mode=='lower': value=value.lower()
        elif mode=='upperFirst': value=value[:1].upper()+value[1:]
        elif mode=='lowerFirst': value=value[:1].lower()+value[1:]
        output.append(value)
    return ''.join(output)


def sequential_projection(text, entries, voice_id, initial=None):
    """Carry original spans through cascading replacements, including deletions."""
    spoken, prior = initial or (text, [])
    origins = []; at = 0; delta = 0
    for m in prior:
        origins.extend((i+delta,i+delta+1) for i in range(at,m['spokenStart']))
        origins.extend([(m['sourceStart'],m['sourceEnd'])]*(m['spokenEnd']-m['spokenStart']))
        at=m['spokenEnd'];delta=m['sourceEnd']-at
    origins.extend((i+delta,i+delta+1) for i in range(at,len(spoken)))
    for entry in entries:
        if not entry.get('enabled',True) or entry.get('voiceId') not in (None,'',voice_id): continue
        pattern = compile_pattern(pattern_text(entry),entry.get('caseSensitive',False))
        pieces, mapped, cursor = [], [], 0
        try:
            for match in pattern.finditer(spoken,timeout=.05):
                a,b=match.span()
                replacement=render_replacement(entry,match)
                if a==b and not replacement: continue
                pieces.append(spoken[cursor:a]);mapped.extend(origins[cursor:a])
                span=(min(x[0] for x in origins[a:b]),max(x[1] for x in origins[a:b])) if a<b else (origins[a][0],origins[a][0]) if a<len(origins) else (len(text),len(text))
                pieces.append(replacement);mapped.extend([span]*len(replacement));cursor=b
                if len(mapped)>max(10000,len(text)*20): raise ValueError('Pronunciation rules expanded the passage too much.')
        except TimeoutError as exc: raise ValueError('A pronunciation pattern took too long. Simplify the rule for '+entry['word'][:80]+'.') from exc
        pieces.append(spoken[cursor:]);mapped.extend(origins[cursor:]);spoken=''.join(pieces);origins=mapped
    mappings=[]; i=0; source_at=0
    while i<len(spoken):
        a,b=origins[i]; end=i+1
        while end<len(spoken) and origins[end][0]<b:
            b=max(b,origins[end][1]);end+=1
        if a>source_at: mappings.append({'sourceStart':source_at,'sourceEnd':a,'spokenStart':i,'spokenEnd':i,'word':text[source_at:a],'spoken':''})
        if text[a:b]!=spoken[i:end]: mappings.append({'sourceStart':a,'sourceEnd':b,'spokenStart':i,'spokenEnd':end,'word':text[a:b],'spoken':spoken[i:end]})
        source_at=b;i=end
    if source_at<len(text): mappings.append({'sourceStart':source_at,'sourceEnd':len(text),'spokenStart':len(spoken),'spokenEnd':len(spoken),'word':text[source_at:],'spoken':''})
    return spoken,mappings


def compare_pronounced(chunk, transcript):
    """Accept source spellings at explicit replacement spans, with exact context.

    ASR commonly restores normal spelling from phonetic respellings. This checks
    content, not whether an engine used the intended phonemes or stress.
    """
    from .speech import compare_transcript
    from .speech_comparison import canonical_tokens
    spoken = chunk['spokenText']
    primary = compare_transcript(spoken, transcript)
    if primary['matched'] or not chunk.get('pronunciationMap'): return primary
    tokens = canonical_tokens(transcript)
    sections = []; cursor = 0
    for mapping in chunk['pronunciationMap']:
        a,b = mapping['spokenStart'],mapping['spokenEnd']
        # Only complete lexical spans qualify. Never accept deleted text being read.
        if a == b or (a and spoken[a-1].isalnum()) or (b < len(spoken) and spoken[b].isalnum()): continue
        sections.append([canonical_tokens(spoken[cursor:a])])
        sections.append([canonical_tokens(spoken[a:b]), canonical_tokens(mapping['word'])])
        cursor = b
    sections.append([canonical_tokens(spoken[cursor:])])
    positions = {0}
    for options in sections:
        positions = {i+len(option) for i in positions for option in options if tokens[i:i+len(option)] == option}
        if not positions: return primary
    if len(tokens) not in positions: return primary
    result = compare_transcript(transcript, transcript)
    result.update(primaryCheck=primary, pronunciationSpellingMatch=True)
    return result
