"""Optional Windows SAPI voices via the Windows-provided speech runtime."""
import hashlib
import json
import os
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


def _call(request):
    if os.name != "nt":
        raise ValueError("Windows SAPI voices are available on Windows only.")
    import base64
    shell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    result = subprocess.run([str(shell), "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.b64encode(SCRIPT.encode("utf-16-le")).decode()],
        input=json.dumps(request, ensure_ascii=True), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError("Windows speech failed: " + result.stderr[-1500:])
    return json.loads(result.stdout.lstrip("\ufeff") or "[]")


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
