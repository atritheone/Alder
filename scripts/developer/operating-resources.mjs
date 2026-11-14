import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Only process ids, executable names and resource counters cross this boundary.
// Never include command lines, document paths or process environment values.
export function processResources(rootPid) {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add([int]$env:ALDER_MEASURE_PID); do {$changed=$false; foreach($entry in $all){if($ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)){$changed=$true}}}while($changed); $rows=@(foreach($entry in $all){if($ids.Contains([int]$entry.ProcessId)){$p=Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue;if($p){[pscustomobject]@{pid=$entry.ProcessId;parent=$entry.ParentProcessId;name=$p.ProcessName;rssBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuSeconds=$p.CPU;handles=$p.HandleCount}}}}); ConvertTo-Json -InputObject $rows -Compress",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
        env: { ...process.env, ALDER_MEASURE_PID: String(rootPid) },
      },
    );
    if (result.status !== 0) return { unavailable: true };
    const rows = JSON.parse(result.stdout || "[]");
    return { processes: Array.isArray(rows) ? rows : [rows] };
  }
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,time=,comm="], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) return { unavailable: true };
  const rows = result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            rssBytes: Number(match[3]) * 1024,
            cpuTime: match[4],
            name: path.basename(match[5]),
          },
        ]
      : [];
  });
  const owned = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
  }
  return { processes: rows.filter((row) => owned.has(row.pid)) };
}
export function diskResources(directory) {
  const bytes = Object.fromEntries(
    ["alder.sqlite3", "alder.sqlite3-wal", "alder.sqlite3-shm"].map((name) => {
      try {
        return [name, fs.statSync(path.join(directory, name)).size];
      } catch {
        return [name, 0];
      }
    }),
  );
  return { bytes };
}
