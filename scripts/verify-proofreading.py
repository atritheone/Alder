"""Exercise installed local rules and model with public synthetic text, never user writing."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alder.proofreading.contracts import configuration, model_correction
from alder.proofreading.engines import Resources, RuleEngine, ModelEngine


def verify(resources, rules_only=False):
    resources = Resources(resources)
    rule = RuleEngine(resources)
    model = ModelEngine(resources)
    report = {"status": "failed", "platform": sys.platform, "externalNetworkBlocked": False,
              "qualityQualification": "not established", "dialects": {}}
    try:
        for dialect in ("en-AU", "en-GB", "en-US"):
            started = time.monotonic()
            matches = rule.check("She go home. This word is mispelled.", configuration({}, {"dialect": dialect}))
            if not any(item["type"] == "spelling" and item["alternatives"] for item in matches):
                raise RuntimeError("Installed spelling check failed for " + dialect)
            if not any(item["type"] == "grammar" for item in matches):
                raise RuntimeError("Installed grammar check failed for " + dialect)
            report["dialects"][dialect] = {"status": "passed", "seconds": round(time.monotonic() - started, 3)}
        if rules_only:
            report["advanced"] = {"status": "unavailable", "reason": "No distributed model runtime for this target."}
        else:
            started = time.monotonic()
            source = "She go to the shops yesterday."
            corrected = model.check(source, configuration({}, {"dialect": "en-AU"}), lambda: False)
            correction = model_correction(source, corrected, [])
            if corrected != "She went to the shops yesterday." or not correction:
                raise RuntimeError("Installed advanced correction did not pass the reference probe.")
            report["advanced"] = {"status": "passed", "seconds": round(time.monotonic() - started, 3),
                                  "revision": resources.revision, "device": "cpu"}
        report["status"] = "passed"
        return report
    finally:
        model.close()
        rule.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()
    result = verify(args.resources, args.rules_only)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", "utf-8")
    print(json.dumps(result))
