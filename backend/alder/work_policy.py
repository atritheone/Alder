"""Cooperative priority at safe boundaries; saves/control never wait on analysis."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Condition
import time

_background = ContextVar('alder_background_checkpoint', default=None)

@contextmanager
def background(policy, cancelled):
    token = _background.set((policy, cancelled))
    try: yield
    finally: _background.reset(token)

def checkpoint():
    current = _background.get()
    if current:
        policy,cancelled = current
        if cancelled() or (policy and not policy.checkpoint(cancelled)): raise InterruptedError('Work cancelled.')


class WorkPolicy:
    def __init__(self):
        self.condition=Condition()
        self.foreground=0
        self.waiting=0
        self.wait_seconds=0.0

    @contextmanager
    def interactive(self):
        with self.condition: self.foreground+=1
        try: yield
        finally:
            with self.condition:
                self.foreground-=1
                self.condition.notify_all()

    def checkpoint(self, cancelled=lambda:False):
        if cancelled(): return False
        with self.condition:
            if not self.foreground: return not cancelled()
            self.waiting+=1
            started=time.monotonic()
            try:
                while self.foreground:
                    if cancelled(): return False
                    self.condition.wait(.02)
                return not cancelled()
            finally:
                self.waiting-=1
                self.wait_seconds+=time.monotonic()-started

    def report(self):
        with self.condition:
            return {'interactive':self.foreground,'waitingBackground':self.waiting,'backgroundWaitMs':self.wait_seconds*1000}
