"""Optional Windows SAPI voices via the Windows-provided speech runtime."""
import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path
import subprocess

SCRIPT = r'''
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
if ($request.operation -eq 'voices') {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { @($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{name=$_.VoiceInfo.Name; culture=$_.VoiceInfo.Culture.Name} }) | ConvertTo-Json -Compress }
  finally { $s.Dispose() }
} else {
  Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;
public class AlderWord { public string text; public int start; public int length; public double seconds; }
public class AlderSapi {
  public static List<AlderWord> Render(string text, string voice, string path, int rate, int volume, int pitch) {
    var words = new List<AlderWord>();
    using (var s = new SpeechSynthesizer()) {
      s.SelectVoice(voice); s.Rate = rate; s.Volume = volume;
      s.SetOutputToWaveFile(path, new SpeechAudioFormatInfo(24000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
      s.SpeakProgress += (o,e) => words.Add(new AlderWord {text=e.Text, start=e.CharacterPosition, length=e.CharacterCount, seconds=e.AudioPosition.TotalSeconds});
      if (pitch == 0) s.Speak(text);
      else s.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + s.Voice.Culture.Name + "'><prosody pitch='" + (pitch >= 0 ? "+" : "") + pitch + "st'>" + System.Security.SecurityElement.Escape(text) + "</prosody></speak>");
    }
    return words;
  }
}
'@
  $words = [AlderSapi]::Render($request.text, $request.voice, $request.path, [int]$request.rate, [int]$request.volume, [int]$request.pitch)
  @{words=@($words)} | ConvertTo-Json -Depth 5 -Compress
}
'''


def _call(payload):
    from .sapi_host import request
    return request(SCRIPT, payload)


def prepare():
    return _call({"operation": "prepare"})


def shutdown():
    from .sapi_host import shutdown as close
    close()


@lru_cache(maxsize=1)
def voices():
    if os.name != "nt":
        return []
    try:
        result = _call({"operation": "voices"})
        if isinstance(result, dict):
            result = [result]
        return [{"id": "sapi-" + hashlib.sha256(v["name"].encode()).hexdigest()[:24], "name": v["name"], "culture": v["culture"],
                 "kind": "sapi", "engine": "sapi", "hash": hashlib.sha256(v["name"].encode()).hexdigest()} for v in result]
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
        return []


def render(voice_id, text, path, rate=0, volume=100, pitch=0):
    voice = next((v for v in voices() if v["id"] == voice_id), None)
    if not voice:
        raise ValueError("This Windows SAPI voice is not installed or is unavailable.")
    return _call({"operation": "render", "voice": voice["name"], "text": text, "path": str(path), "rate": rate, "volume": volume, "pitch": pitch})


NATIVE_TIMING_VERSION = 4


def native_timings(events, duration):
    """SAPI progress describes source spans, not an independent transcript.

    Some engines report overlapping spans ("took", then "took A"). Count each
    source span once, retaining later occurrences at distinct positions. The
    positions are UTF-16 units, including SSML offsets when pitched.
    Only relative overlap is used, so markup prefixes do not shift the words.
    """
    covered = 0
    groups = []
    for event in events:
        start = int(event['start'])
        # CharacterCount can include extra XML-entity characters in SSML (an
        # ampersand adds four even to unrelated words). Text is already decoded.
        encoded = event['text'].encode('utf-16-le')
        length = len(encoded) // 2
        end = start + length
        if start < 0 or length <= 0 or end <= covered:
            continue
        overlap = max(0, covered - start)
        remaining = encoded[overlap * 2:].decode('utf-16-le')
        source_start = start + overlap + len(remaining[:len(remaining)-len(remaining.lstrip())].encode('utf-16-le')) // 2
        text = remaining.strip()
        covered = end
        if text:
            groups.append((text, max(0., min(duration, float(event['seconds']))), source_start))
    words = []
    previous_end = None
    for i, (text, start, source_start) in enumerate(groups):
        end = max(start, groups[i+1][1] if i+1 < len(groups) else duration)
        tokens = list(re.finditer(r'\S+', text))
        total = sum(len(token.group()) for token in tokens)
        offset = 0
        for match in tokens:
            token = match.group()
            token_start = source_start + len(text[:match.start()].encode('utf-16-le')) // 2
            next_offset = offset + len(token)
            word_end = start+(end-start)*next_offset/total
            if words and previous_end == token_start:
                # One written token may produce several native events: 1898
                # becomes 18 + 98, decimals and abbreviations split likewise.
                words[-1]['text'] += token
                words[-1]['endSeconds'] = word_end
            else:
                words.append({'text':token, 'startSeconds':start+(end-start)*offset/total,
                              'endSeconds':word_end})
            previous_end = token_start + len(token.encode('utf-16-le')) // 2
            offset = next_offset
    return words
