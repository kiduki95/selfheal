import { execFileSync } from 'node:child_process';

// Git-history readers for code-health. ONE git-log pass feeds both churn (how often a file changes) and
// co-change (which files change together — cochange.ts). Best-effort: a non-git rootDir or any git failure
// yields an EMPTY result (metrics simply absent, never throws). Paths are repo-relative (posix) with the
// rootDir prefix stripped, so they line up with scan's keys even when rootDir is a subdir of the repo.

export interface Churn {
  commits: number; // commits touching the file within the window
  days: number; // distinct calendar days with a commit (a recency/spread proxy)
}

// One commit's footprint: the date and the set of files it touched.
export interface GitCommit {
  day: string;
  files: string[];
}

// Read commits in the window as {day, files}. The single source of git history for churn + co-change.
export function readGitCommits(rootDir: string, windowDays = 90): GitCommit[] {
  let prefix = '';
  let log: string;
  try {
    // git log emits REPO-ROOT-relative paths; scan keys are rootDir-relative. When rootDir is a subdir,
    // strip its prefix so the keys line up (else churn/co-change would silently never match).
    prefix = execFileSync('git', ['-C', rootDir, 'rev-parse', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // -c core.quotePath=false → non-ASCII paths emitted verbatim (not octal-escaped) so they match too.
    // \x01 + date marks each commit header; the lines until the next blank are that commit's files.
    log = execFileSync(
      'git',
      ['-C', rootDir, '-c', 'core.quotePath=false', 'log', `--since=${windowDays} days ago`, '--no-merges', '--name-only', '--date=short', '--pretty=format:\x01%ad'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return []; // not a git repo / git unavailable → no history
  }

  const commits: GitCommit[] = [];
  let cur: GitCommit | null = null;
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 1) { cur = { day: line.slice(1), files: [] }; commits.push(cur); continue; } // commit header
    let path = line; // repo-root-relative posix path
    if (prefix) {
      if (!path.startsWith(prefix)) continue; // outside the scanned subdir
      path = path.slice(prefix.length);
    }
    if (cur) cur.files.push(path);
  }
  return commits;
}

// Per-file churn from commits: commit count + distinct-day count within the window.
export function churnFromCommits(commits: GitCommit[]): Map<string, Churn> {
  const out = new Map<string, Churn>();
  const daySets = new Map<string, Set<string>>();
  for (const c of commits) {
    for (const path of c.files) {
      const ch = out.get(path) ?? { commits: 0, days: 0 };
      ch.commits++;
      out.set(path, ch);
      const ds = daySets.get(path) ?? new Set<string>();
      ds.add(c.day);
      daySets.set(path, ds);
    }
  }
  for (const [p, ds] of daySets) out.get(p)!.days = ds.size;
  return out;
}

// Convenience: read + derive churn in one call (the injection API used by the scan script).
export function computeChurn(rootDir: string, windowDays = 90): Map<string, Churn> {
  return churnFromCommits(readGitCommits(rootDir, windowDays));
}
