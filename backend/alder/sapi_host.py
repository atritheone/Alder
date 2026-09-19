"""One hidden Windows speech process; compile the native bridge once."""
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

_lock = threading.RLock()
_process = None
_responses = None


def shutdown():
    global _process
    with _lock:
        if _process is not None:
            if _process.poll() is None:
                _process.terminate()
                try:
                    _process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    _process.kill()
                    _process.wait(timeout=2)
            for pipe in (_process.stdin, _process.stdout):
                if pipe:
                    pipe.close()
            _process = None


def request(original_script, payload):
    global _process, _responses
    if os.name != "nt":
        raise ValueError("Windows SAPI voices are available on Windows only.")
    with _lock:
        if _process is None or _process.poll() is not None:
            shutdown()
            native = original_script.split("-TypeDefinition @'\n", 1)[1].split("\n'@", 1)[0]
            script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Speech\nAdd-Type -ReferencedAssemblies System.Speech -TypeDefinition @'\n" + native + "\n'@\n" + r'''
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.operation -eq 'prepare') { [AlderSapi]::Prepare($request.voice); @{ready=$true} | ConvertTo-Json -Compress }
    elseif ($request.operation -eq 'voices') {
      $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
      try { @{voices=@($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{name=$_.VoiceInfo.Name; culture=$_.VoiceInfo.Culture.Name} })} | ConvertTo-Json -Depth 5 -Compress }
      finally { $s.Dispose() }
    } else {
      $words = [AlderSapi]::Render($request.text, $request.voice, $request.path, [int]$request.rate, [int]$request.volume, [int]$request.pitch)
      @{words=@($words)} | ConvertTo-Json -Depth 5 -Compress
    }
  } catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress }
}
'''
            shell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            _process = subprocess.Popen([str(shell), "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.b64encode(script.encode("utf-16-le")).decode()],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
            _responses = queue.Queue()
            process, responses = _process, _responses
            def read():
                try:
                    for line in process.stdout:
                        try:
                            responses.put(json.loads(line.lstrip("\ufeff")))
                        except ValueError:
                            continue
                finally:
                    responses.put({"error": "Windows speech host exited."})
            threading.Thread(target=read, daemon=True).start()
        try:
            _process.stdin.write(json.dumps(payload, ensure_ascii=True) + "\n")
            _process.stdin.flush()
            result = _responses.get(timeout=30)
            if result.get("error"):
                raise RuntimeError(result["error"])
            return result.get("voices", result)
        except (OSError, queue.Empty, RuntimeError) as exc:
            shutdown()
            raise RuntimeError("Windows speech could not finish. Retry playback.") from exc
