import { execFileSync } from 'node:child_process';

// Git-history churn per file — the behavioral/temporal dimension of code health (CodeScene: hotspot =
// churn × complexity). Best-effort: a non-git rootDir or any git failure yields an EMPTY map (churn simply
// absent, never throws). Paths are git-relative (posix), which line up with scan's repo-relative keys when
// rootDir is the repo root (the codeflow-scan default + the documented assumption).

export interface Churn {
  commits: number; // commits touching the file within the window
  days: number; // distinct calendar days with a commit (a recency/spread proxy)
}

export function computeChurn(rootDir: string, windowDays = 90): Map<string, Churn> {
  const out = new Map<string, Churn>();
  let prefix = '';
  let log: string;
  try {
    // git log emits REPO-ROOT-relative paths, but scan keys are rootDir-relative. When rootDir is a
    // subdir, strip its prefix so the keys line up (else untested_hotspot would silently never match).
    prefix = execFileSync('git', ['-C', rootDir, 'rev-parse', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // -c core.quotePath=false → non-ASCII paths emitted verbatim (not octal-escaped) so they match too.
    // \x01 + date marks each commit header; the lines until the next blank are that commit's files.
    log = execFileSync(
      'git',
      ['-C', rootDir, '-c', 'core.quotePath=false', 'log', `--since=${windowDays} days ago`, '--no-merges', '--name-only', '--date=short', '--pretty=format:\x01%ad'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return out; // not a git repo / git unavailable → no churn metrics
  }

  const daySets = new Map<string, Set<string>>();
  let curDay = '';
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 1) { curDay = line.slice(1); continue; } // commit header → its date
    let path = line; // repo-root-relative posix path
    if (prefix) {
      if (!path.startsWith(prefix)) continue; // outside the scanned subdir → not a scan key
      path = path.slice(prefix.length);
    }
    const c = out.get(path) ?? { commits: 0, days: 0 };
    c.commits++;
    out.set(path, c);
    const ds = daySets.get(path) ?? new Set<string>();
    ds.add(curDay);
    daySets.set(path, ds);
  }
  for (const [p, ds] of daySets) out.get(p)!.days = ds.size;
  return out;
}
