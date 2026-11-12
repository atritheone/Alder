"""Responsive loopback transport with exactly one owned native inference call."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import threading


def create_server(address,identity,evaluate):
    lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,value,status=200):
            raw=json.dumps(value,ensure_ascii=False).encode('utf8')
            try:
                self.send_response(status);self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            except (BrokenPipeError,ConnectionAbortedError,ConnectionResetError):pass
        def do_GET(self):
            self.reply(identity) if self.path=='/' else self.reply({'error':'NotFound'},404)
        def do_POST(self):
            if self.path not in ('/','/shutdown'):
                self.reply({'error':'NotFound'},404);return
            if not lock.acquire(blocking=False):
                # Never queue another native call behind an expired client.
                self.reply({'error':'JudgeBusy'},503);return
            try:
                if self.path=='/shutdown':
                    self.reply({'status':'stopping'})
                    threading.Thread(target=server.shutdown,daemon=True).start();return
                self.connection.settimeout(5)
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:raise ValueError('Invalid judge request size.')
                raw=self.rfile.read(length)
                if len(raw)!=length:raise ValueError('Incomplete judge request.')
                self.reply(evaluate(json.loads(raw)))
            except Exception as error:
                # Exception messages can contain source text; return only types.
                self.reply({'error':type(error).__name__},422)
            finally:lock.release()
    server=ThreadingHTTPServer(address,Handler)
    server.daemon_threads=False;server.block_on_close=True
    return server
