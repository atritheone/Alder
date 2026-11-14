"""Weighted LRU for immutable derived results; callers own synchronisation."""
from collections import OrderedDict
import json


class ByteCache(OrderedDict):
    def __init__(self, maximum_bytes=16*1024*1024, maximum_entries=32768):
        super().__init__()
        self.maximum_bytes=maximum_bytes
        self.maximum_entries=maximum_entries
        self.retained_bytes=0
        self.weights={}

    def __setitem__(self,key,value):
        weight=256+len(str(key))*2+len(json.dumps(value,ensure_ascii=False).encode('utf-8'))*2
        if key in self: self.__delitem__(key)
        if weight>self.maximum_bytes:return
        super().__setitem__(key,value);self.weights[key]=weight;self.retained_bytes+=weight
        while self.retained_bytes>self.maximum_bytes or len(self)>self.maximum_entries:self.popitem(last=False)

    def __delitem__(self,key):
        super().__delitem__(key);self.retained_bytes-=self.weights.pop(key)

    def popitem(self,last=True):
        key,value=super().popitem(last=last);self.retained_bytes-=self.weights.pop(key);return key,value

    def clear(self):
        super().clear();self.weights.clear();self.retained_bytes=0
