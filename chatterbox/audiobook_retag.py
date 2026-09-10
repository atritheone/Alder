"""Apply the final metadata-title convention without re-encoding any audio."""
import hashlib
import json
import os
from pathlib import Path
from mutagen.id3 import ID3, TIT2
from mutagen.flac import FLAC

root = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"
plan = json.loads((root / "plan.json").read_text(encoding="utf-8"))
output = Path(plan["output"])
for track in plan["tracks"]:
    directory = root / f"track-{track['track']:02d}"
    checkpoint = directory / "packaged.json"
    if not checkpoint.exists():
        continue
    packed = json.loads(checkpoint.read_text(encoding="utf-8"))
    old_filename = packed["file"]
    final_filename = f"{track['track']:02d}. {track['title']}.mp3"
    mp3_hash = None
    for parent in [output, output / "MP3"]:
        file = parent / old_filename
        if not file.exists():
            continue
        if file.name != final_filename:
            file = file.rename(parent / final_filename)
        tags = ID3(file)
        if str(tags["TIT2"]) != track["metadata_title"]:
            tags.setall("TIT2", [TIT2(encoding=1, text=track["metadata_title"])])
            tags.save(file, v2_version=3)
        if parent == output or mp3_hash is None:
            mp3_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    if mp3_hash:
        packed["sha256"] = mp3_hash
        packed["file"] = final_filename
        checkpoint.write_text(json.dumps(packed, indent=2), encoding="utf-8")
    flac = output / "FLAC" / Path(old_filename).with_suffix(".flac").name
    flac_checkpoint = directory / "flac.json"
    if flac.exists() and flac_checkpoint.exists():
        final_flac = flac.with_name(Path(final_filename).with_suffix(".flac").name)
        if flac != final_flac:
            flac = flac.rename(final_flac)
        audio = FLAC(flac)
        if audio["TITLE"] != [track["metadata_title"]]:
            audio["TITLE"] = track["metadata_title"]
            audio.save()
        data = json.loads(flac_checkpoint.read_text(encoding="utf-8"))
        data["sha256"] = hashlib.sha256(flac.read_bytes()).hexdigest()
        data["mp3_sha256"] = mp3_hash
        data["file"] = str(flac.relative_to(output))
        flac_checkpoint.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"{track['track']:02d}: {track['metadata_title']}")
