"""Single bounded request to an identity-checked local developer judge."""
import argparse
import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from common import digest


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Local judge redirects are disabled.')


def loopback_opener():
    # A machine-wide proxy or HTTP redirect must not move document text off host.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())


def main():
    sys.stdin.reconfigure(encoding='utf-8',errors='strict')
    sys.stdout.reconfigure(encoding='utf-8',errors='strict')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--template',choices=['auto','qwen-nonthinking','harmony-native-v1','harmony-native-v2','phi4-native-v1','gguf-native-v1','gguf-pointwise-v1','gguf-specialist-pointwise-v1','mistral-reference-v1','phi4-reasoning-v1'],default='auto')
    parser.add_argument('--timeout',type=float,default=120)
    parser.add_argument('--identity-sha256',help='Expected complete server configuration identity')
    parser.add_argument('--preflight',action='store_true',help='Verify the loaded server without performing inference')
    args=parser.parse_args()
    url=urllib.parse.urlsplit(args.url)
    if url.scheme!='http' or url.hostname!='127.0.0.1' or url.username or url.password:
        raise ValueError('Judge must be an explicit loopback endpoint.')
    opener=loopback_opener()
    try:
        with opener.open(args.url,timeout=5) as response:identity=json.load(response)
    except (TimeoutError,urllib.error.URLError):
        print(json.dumps({'failure':'JudgeUnavailable','phase':'identity'}),file=sys.stderr);return 75
    if identity['modelSHA256']!=args.sha256:raise ValueError('Wrong evaluator model.')
    if identity['template']!=args.template:raise ValueError('Wrong evaluator prompt template.')
    if args.template in ('harmony-native-v1','harmony-native-v2','phi4-native-v1','gguf-native-v1','gguf-pointwise-v1','gguf-specialist-pointwise-v1','mistral-reference-v1','phi4-reasoning-v1') and not args.identity_sha256:raise ValueError('Native judge configuration must be pinned.')
    if args.identity_sha256 and digest(identity)!=args.identity_sha256:raise ValueError('Evaluator configuration identity changed.')
    if args.preflight:
        print(json.dumps(identity,ensure_ascii=False));return
    payload=sys.stdin.read(65537)
    if len(payload)>65536:raise ValueError('Judge input too large.')
    request=urllib.request.Request(args.url,data=payload.encode('utf-8'),headers={'Content-Type':'application/json'})
    if not 0<args.timeout<=1800:raise ValueError('Invalid local judge deadline.')
    try:
        with opener.open(request,timeout=args.timeout) as response:result=json.load(response)
    except urllib.error.HTTPError as error:
        if error.code!=503:raise
        print(json.dumps({'failure':'JudgeBusy','phase':'inference'}),file=sys.stderr);return 75
    except (TimeoutError,urllib.error.URLError):
        print(json.dumps({'failure':'JudgeUnavailable','phase':'inference'}),file=sys.stderr);return 75
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':raise SystemExit(main())
