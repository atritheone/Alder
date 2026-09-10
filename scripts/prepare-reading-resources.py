"""Provision the pinned local document extractor at build time."""
import hashlib
import json
from pathlib import Path
import urllib.request

VERSION = "3.3.2"
SHA512 = "88c2032cba0d45feea361e6eebd2918bd04707614cdda5d89a1b167da5503c98e7b4cd368336f0402d559abcaf5006fcc7c825c32c749ae0417ea2f3b8423aba"
URL = f"https://downloads.apache.org/tika/{VERSION}/tika-app-{VERSION}.jar"

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1] / "work/bundle-resources/tools/tika"
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"tika-app-{VERSION}.jar"
    if not target.is_file() or hashlib.sha512(target.read_bytes()).hexdigest() != SHA512:
        temporary = target.with_suffix(".download")
        urllib.request.urlretrieve(URL, temporary)
        if hashlib.sha512(temporary.read_bytes()).hexdigest() != SHA512:
            raise RuntimeError("Tika distribution checksum mismatch.")
        temporary.replace(target)
    (root / "manifest.json").write_text(json.dumps({"version": VERSION, "url": URL, "sha512": SHA512,
        "checksumSource": URL + ".sha512", "licence": "Apache-2.0 and embedded component licences", "licenceLocation": "META-INF/LICENSE and META-INF/NOTICE inside the original JAR"}, indent=2), encoding="utf-8")
    print(f"Verified local document extractor: {target}")
