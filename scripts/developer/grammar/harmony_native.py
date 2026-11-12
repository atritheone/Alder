"""Reach a native final header using token IDs; never decode private content."""
import time
from native_reasoning import ReasoningFailure


def final_prefix(model, tokens, maximum_tokens, context_tokens=4096, final_tokens=480, deadline=None):
    if type(maximum_tokens) is not int or not 128 <= maximum_tokens <= 8192:
        raise ValueError('Invalid Harmony native token allowance.')
    if type(context_tokens) is not int or not 4096 <= context_tokens <= 16384:
        raise ValueError('Invalid Harmony context allowance.')
    budget = min(maximum_tokens, context_tokens-len(tokens)-final_tokens-16)
    if budget < 128:
        raise ValueError('Harmony input exceeds context allowance.')
    encode = lambda value: tuple(model.tokenize(value, add_bos=False, special=False))
    # Recognize only fixed public header names, including surrounding syntax
    # whitespace. Never detokenize a generated header or private body to strip it.
    padding=(b'',b' ',b'  ',b'\n',b'\t',b'\r\n',b' \n',b'\n ')
    def forms(name):return {encode(left+name+right) for left in padding for right in padding}
    channels = {tokens:name.decode('ascii') for name in (b'analysis',b'commentary',b'final') for tokens in forms(name)}
    assistant = forms(b'assistant')
    # Both are public format names: JSON, and the named response format
    # explicitly declared in this adapter's developer prompt.
    formats = forms(b'json')|forms(b'grammar_judgment')
    generated, header, role = [], [], []
    state = 'initial'
    stop = 'budget'
    iterator = model.generate(tokens, temp=0, top_k=0, top_p=1, min_p=0, repeat_penalty=1, reset=True)
    def failure(code):
        return ReasoningFailure('Harmony native final header was not reached.', code, len(generated), budget)
    try:
        for token in iterator:
            if deadline is not None and time.monotonic() >= deadline:
                raise failure('deadline')
            if token == model.token_eos():
                stop = 'eos'
                break
            generated.append(token)
            if state == 'initial':
                if token != 200005:
                    raise failure('invalid-header')
                header = []; state = 'channel'
            elif state == 'channel':
                if token == 200008:
                    base = header
                    if 200003 in base:
                        position = base.index(200003)
                        if tuple(base[position+1:]) not in formats:
                            raise failure('unsupported-format')
                        base = base[:position]
                    channel = channels.get(tuple(base))
                    if channel is None:
                        raise failure('unsupported-channel')
                    if channel == 'final':
                        return [*tokens, *generated], {'reasoningTokens': len(generated), 'reasoningBudget': budget}
                    state = 'body'
                else:
                    header.append(token)
                    if len(header) > 32:
                        raise failure('invalid-header')
            elif state == 'body':
                if token == 200007:
                    state = 'message'
                elif token in (200006, 200012, 200002):
                    raise failure('non-final-stop')
            elif state == 'message':
                if token != 200006:
                    raise failure('invalid-header')
                role = []; state = 'role'
            elif state == 'role':
                if token == 200005:
                    if tuple(role) not in assistant:
                        raise failure('invalid-role')
                    header = []; state = 'channel'
                else:
                    role.append(token)
                    if len(role) > 16:
                        raise failure('invalid-role')
            if len(generated) >= budget:
                break
    finally:
        iterator.close()
    raise failure(stop)
