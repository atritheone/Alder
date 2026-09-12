"""Extract the supplied Sitka Text collection face for UI and PDF embedding."""
from pathlib import Path
from fontTools.ttLib import TTCollection
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path, help="Directory containing Sitka.ttc, SitkaB.ttc, SitkaI.ttc, SitkaZ.ttc")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
web = root / "frontend/public/fonts"
pdf = root / "backend/alder/fonts"
web.mkdir(parents=True, exist_ok=True)
pdf.mkdir(parents=True, exist_ok=True)
for source, suffix in [("Sitka", "Regular"), ("SitkaB", "Bold"), ("SitkaI", "Italic"), ("SitkaZ", "BoldItalic")]:
    collection = TTCollection(args.source / (source + ".ttc"))
    font = next(f for f in collection.fonts if f["name"].getDebugName(1) == "Sitka Text")
    font.save(pdf / f"SitkaText-{suffix}.ttf")
    font.flavor = "woff2"
    font.save(web / f"SitkaText-{suffix}.woff2")
    print(f"Prepared Sitka Text {suffix}")
