// Shows (and with --kill, closes) browsers started by Playwright. Only processes whose
// executable lives in the ms-playwright cache are matched, never your own Chrome/Edge.
//   node scripts/browser-memory.mjs          → report
//   node scripts/browser-memory.mjs --kill   → close all Playwright browsers (also the kept-open one)
import os from 'node:os';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('Windows only for now.');
  process.exit(0);
}
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });

const rows = JSON.parse(
  ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*ms-playwright*' } | ForEach-Object {
        [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; mb = [math]::Round((Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 / 1MB) } }) | ConvertTo-Json -Compress`) || '[]',
);
const list = Array.isArray(rows) ? rows : [rows];
const total = list.reduce((s, r) => s + (r.mb ?? 0), 0);
console.log(`RAM free: ${(os.freemem() / 1024 ** 3).toFixed(1)} of ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`);
console.log(`Playwright browser processes: ${list.length}, ${total} MB`);

if (process.argv.includes('--kill') && list.length) {
  const pids = new Set(list.map((r) => r.pid));
  const roots = list.filter((r) => !pids.has(r.parent)).map((r) => r.pid); // browser main processes
  for (const pid of roots) ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
  console.log(`Closed ${roots.length} Playwright browser(s).`);
}
