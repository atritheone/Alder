"""Independent local speech-to-text verification worker. JSON-lines protocol."""
import difflib
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from faster_whisper import WhisperModel
from num2words import num2words

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox"
MODELS = {}


def words(text):
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    text = re.sub(r"\d+", lambda m: num2words(int(m.group())), text)
    # Orthographic alternatives with the same spoken form, not content omissions.
    text = text.replace("'", "")
    result = re.findall(r"[a-z]+", text)
    variants = {"learned": "learnt", "fulfillment": "fulfilment", "fulfill": "fulfil", "fulfills": "fulfils",
                "recognize": "recognise", "recognized": "recognised", "recognizing": "recognising",
                "recognizable": "recognisable", "recognizes": "recognises", "realize": "realise",
                "realized": "realised", "realizing": "realising", "realizes": "realises",
                "organize": "organise", "organized": "organised", "color": "colour", "colors": "colours",
                "center": "centre", "centers": "centres", "honor": "honour", "honored": "honoured",
                "eye": "i", "site": "sight", "patients": "patience", "judgment": "judgement", "judgments": "judgements",
                "unrecognizable": "unrecognisable", "practise": "practice", "practises": "practices",
                "licence": "license", "defense": "defence", "offense": "offence",
                "demeanor": "demeanour", "honourable": "honorable", "splendor": "splendour",
                "pretense": "pretence", "analyze": "analyse", "analyzed": "analysed", "analyzing": "analysing",
                "analyzes": "analyses", "labor": "labour", "labors": "labours", "labored": "laboured",
                "centered": "centred", "honoring": "honouring", "favor": "favour", "favors": "favours",
                "apologize": "apologise", "apologizes": "apologises", "authorized": "authorised",
                "dishonored": "dishonoured", "favored": "favoured", "honors": "honours", "humor": "humour",
                "meager": "meagre", "organizer": "organiser", "practiced": "practised", "theater": "theatre",
                "skillful": "skilful", "skillfully": "skilfully"}
    return [variants.get(w, w) for w in result]


def compare(expected, actual):
    a, b = words(expected), words(actual)
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j-1] + (x != y)))
        row = nxt
    differences = []
    for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            differences.append({"type": tag, "expected": " ".join(a[i:j]), "heard": " ".join(b[k:l])})
    return {"accepted": a == b, "wer": row[-1] / max(len(a), 1), "differences": differences}


def transcribe(path, name):
    if name not in MODELS:
        MODELS[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=6,
                                   download_root=str(ROOT / "qa-models"))
    segments, info = MODELS[name].transcribe(path, language="en", beam_size=5, temperature=0,
                                            condition_on_previous_text=False, vad_filter=False)
    return " ".join(s.text.strip() for s in segments)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        try:
            request = json.loads(line)
            results = []
            for name in request.get("models", ["base.en", "small.en"]):
                transcript = transcribe(request["path"], name)
                result = {"model": name, "transcript": transcript, **compare(request["text"], transcript)}
                results.append(result)
                if result["accepted"]:
                    break
            answer = {"accepted": any(r["accepted"] for r in results), "results": results}
        except Exception as exc:
            answer = {"error": repr(exc)}
        print(json.dumps(answer, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
