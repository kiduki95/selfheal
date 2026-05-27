import type { GitCommit } from './churn.js';

// Change coupling (co-change) from git history — Tornhill's logical/evolutionary coupling. Files committed
// together are logically coupled, revealing dependencies static analysis misses. support = # commits a pair
// changed together; confidence(A->B) = support / changes(A) = "when A changes, how often does B change too".
// scan.ts crosses these with the STRUCTURAL graph to flag HIDDEN coupling (co-change but no import/call edge).

export interface CochangePair {
  src: string; // file A
  dst: string; // file B
  support: number; // commits where both changed
  confidence: number; // support / changes(src), in (0,1]
}

export interface CochangeOptions {
  maxCommitFiles?: number; // skip sweeping commits (mass rename/format) that touch more than this — noise
  minSupport?: number; // ignore pairs seen fewer times than this (noise floor)
  minConfidence?: number; // ignore weak directional coupling
}

const DEFAULTS: Required<CochangeOptions> = { maxCommitFiles: 25, minSupport: 2, minConfidence: 0.3 };

// Pair-key delimiter = NUL. A NUL byte cannot occur in a git path, whereas a space CAN (e.g. "Nav Bar.tsx")
// and would corrupt the split for spaced paths. Built via fromCharCode so the source stays plain ASCII.
const SEP = String.fromCharCode(0);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function cochangeFromCommits(commits: GitCommit[], opts: CochangeOptions = {}): CochangePair[] {
  const o = { ...DEFAULTS, ...opts };
  const changes = new Map<string, number>(); // file -> # non-bulk commits touching it (confidence denominator)
  const pairSupport = new Map<string, number>(); // "a<NUL>b" (a<b) -> co-change count

  for (const c of commits) {
    const files = [...new Set(c.files)];
    if (files.length === 0 || files.length > o.maxCommitFiles) continue; // skip empty + bulk-sweep commits
    for (const f of files) changes.set(f, (changes.get(f) ?? 0) + 1); // solo commits count here (no pairs)
    if (files.length < 2) continue;
    files.sort();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i]! + SEP + files[j]!;
        pairSupport.set(key, (pairSupport.get(key) ?? 0) + 1);
      }
    }
  }

  const out: CochangePair[] = [];
  for (const [key, support] of pairSupport) {
    if (support < o.minSupport) continue;
    const [a, b] = key.split(SEP) as [string, string];
    // Directed both ways — confidence is asymmetric (a hub file changes often, so conf INTO it is low).
    const confAB = support / (changes.get(a) ?? support);
    const confBA = support / (changes.get(b) ?? support);
    if (confAB >= o.minConfidence) out.push({ src: a, dst: b, support, confidence: round3(confAB) });
    if (confBA >= o.minConfidence) out.push({ src: b, dst: a, support, confidence: round3(confBA) });
  }
  return out;
}
