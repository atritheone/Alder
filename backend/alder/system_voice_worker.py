"""JSON-lines process for OS speech; no native speech library enters the server."""
import json
import sys


def main():
    engine = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if engine is None:
                if sys.argv[1] == "espeak":
                    from system_voice_espeak import Engine
                elif sys.argv[1] == "macos":
                    from system_voice_macos import Engine
                else:
                    raise ValueError("Unknown system speech provider.")
                engine = Engine()
            if sys.argv[1] == "macos":
                import objc
                with objc.autorelease_pool():
                    result = engine.request(request)
            else:
                result = engine.request(request)
        except Exception as exc:
            result = {"error": str(exc)}
        print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
