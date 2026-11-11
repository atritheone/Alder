"""Bound a verified native thinking phase without decoding its content."""


class ReasoningFailure(ValueError):
    """Public fixed codes and token counts only; never generated content."""
    def __init__(self,message,code,generated,budget):
        super().__init__(message)
        self.diagnostic={'reasoningFailure':code,'generatedTokens':generated,'reasoningBudget':budget}


def reasoning_prefix(model,tokens,maximum_tokens,context_tokens=4096,final_tokens=450,
                     ending=b'</think>',opening=None,sampling=None):
    if type(maximum_tokens) is not int or not 128<=maximum_tokens<=2048:
        raise ValueError('Invalid native reasoning token budget.')
    budget=min(maximum_tokens,context_tokens-len(tokens)-final_tokens-16)
    if budget<128:raise ValueError('Native reasoning input exceeds context budget.')
    end_ids=model.tokenize(ending,add_bos=False,special=True)
    if len(end_ids)!=1 or model.detokenize(end_ids,special=True)!=ending:
        raise ValueError('Unverified native thinking end token.')
    opening_ids=model.tokenize(opening,add_bos=False,special=True) if opening else None
    if opening_ids is not None and (len(opening_ids)!=1 or model.detokenize(opening_ids,special=True)!=opening):
        raise ValueError('Unverified native thinking start token.')
    parameters={'temp':0,'top_k':0,'top_p':1}
    if sampling is not None:
        if set(sampling)!={'temp','top_k','top_p'} or type(sampling['temp']) not in (int,float) or not 0<sampling['temp']<=1 or type(sampling['top_k']) is not int or not 1<=sampling['top_k']<=100 or type(sampling['top_p']) not in (int,float) or not 0<sampling['top_p']<=1:
            raise ValueError('Invalid native reasoning sampling profile.')
        parameters=sampling
    generated=[];completed=False;stop='budget'
    iterator=model.generate(tokens,**parameters,repeat_penalty=1,reset=True)
    try:
        for token in iterator:
            if token==model.token_eos():stop='eos';break
            if not generated and opening_ids is not None and token!=opening_ids[0]:
                raise ReasoningFailure('Native generation did not open the expected thinking channel.',
                  'missing-native-opening',0,budget)
            generated.append(token)
            if token==end_ids[0]:completed=True;break
            if len(generated)>=budget:break
    finally:iterator.close()
    if not completed:
        raise ReasoningFailure('Native reasoning did not finish within its token budget.',stop,len(generated),budget)
    return [*tokens,*generated],{'reasoningTokens':len(generated),'reasoningBudget':budget}
