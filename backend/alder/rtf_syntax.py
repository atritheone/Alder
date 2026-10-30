"""Bounded RTF groups and control words; binary payloads never become code."""
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Control:
    name: str
    value: int | None = None


@dataclass(frozen=True)
class Binary:
    data: bytes


WORD = re.compile(br'([a-zA-Z]{1,32})(-?\d{1,10})? ?')


def parse(data):
    data=data.strip()
    if not data.startswith(b'{\\rtf1') or not data.endswith(b'}'):
        raise ValueError('The file is not a complete RTF document.')
    root=[];stack=[root];i=0;tokens=0
    while i<len(data):
        tokens+=1
        if tokens>2000000:raise ValueError('RTF has too many formatting tokens.')
        value=data[i];i+=1
        if value==123:
            child=[];stack[-1].append(child);stack.append(child)
            if len(stack)>100:raise ValueError('RTF groups are too deeply nested.')
        elif value==125:
            if len(stack)==1:raise ValueError('RTF has an unmatched closing brace.')
            stack.pop()
        elif value==92:
            if i>=len(data):raise ValueError('RTF ends inside an escape.')
            word=WORD.match(data,i)
            if word:
                name=word[1].decode('ascii');number=int(word[2]) if word[2] else None;i=word.end()
                if i<len(data) and data[i-1]!=32 and ((not word[2] and len(word[1])==32 and chr(data[i]).isalpha()) or (word[2] and len(word[2].lstrip(b'-'))==10 and 48<=data[i]<=57)):
                    raise ValueError('RTF contains an excessively long control word or number.')
                if name=='bin':
                    if number is None or number<0 or number>20*1024*1024 or i+number>len(data):raise ValueError('RTF contains invalid or excessive binary data.')
                    stack[-1].append(Binary(data[i:i+number]));i+=number
                else:stack[-1].append(Control(name,number))
            elif data[i]==39:
                value=data[i+1:i+3]
                if not re.fullmatch(br'[\da-fA-F]{2}',value):raise ValueError('RTF contains an invalid hexadecimal escape.')
                stack[-1].append(bytes([int(value,16)]));i+=3
            else:
                char=chr(data[i]);i+=1
                stack[-1].append(char.encode('ascii') if char in '\\{}' else Control(char))
        else:
            end=i
            while end<len(data) and data[end] not in b'\\{}':end+=1
            text=data[i-1:end].replace(b'\r',b'').replace(b'\n',b'')
            if text:stack[-1].append(text)
            i=end
    if len(stack)!=1 or len(root)!=1 or not isinstance(root[0],list):raise ValueError('RTF groups are unbalanced.')
    if not root[0] or root[0][0]!=Control('rtf',1):raise ValueError('Unsupported RTF version.')
    return root[0]


def destination(group):
    return next((item.name for item in group if isinstance(item,Control) and item.name!='*'),None)


def controls(group):
    return {item.name:item.value for item in group if isinstance(item,Control)}


def escape(value):
    """Use signed UTF-16 escapes, including both halves of supplementary text."""
    output=[]
    for char in value:
        if char in '\\{}':output.append('\\'+char)
        elif char=='\t':output.append('\\tab ')
        elif char=='\n':output.append('\\line ')
        elif 32<=ord(char)<=126:output.append(char)
        else:
            data=char.encode('utf-16-le')
            for i in range(0,len(data),2):
                code=int.from_bytes(data[i:i+2],'little');output.append('\\u'+str(code if code<32768 else code-65536)+'?')
    return ''.join(output)
