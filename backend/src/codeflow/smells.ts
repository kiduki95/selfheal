// Code-smell detection (code-health P1) — pure, deterministic, threshold-based (SonarQube-style), no LLM.
// Consumes per-artifact metrics assembled by scan.ts and emits smells + per-artifact health. The keystone
// is `untested_hotspot` = churn × complexity × fan-in on an UNtested file (CodeScene's behavioral thesis:
// debt in high-activity, complex, depended-on, untested code has the highest interest rate).

export type SmellKind = 'god_file' | 'complex_function' | 'untested_hotspot';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

// One artifact's deterministic metrics (file or symbol). Churn/has_test only meaningful for files.
export interface ArtifactMetric {
  key: string;
  kind: 'file' | 'symbol' | 'module';
  symbolKind?: string; // 'function' | 'class' | 'var' | ... (symbols only)
  loc: number;
  cyclomatic: number;
  fanIn: number;
  fanOut: number;
  churnCommits: number;
  hasTest: boolean;
  symbolCount?: number; // contained symbols (files only)
}

export interface SmellSpec {
  artifactKey: string;
  kind: SmellKind;
  severity: Severity;
  score: number; // 0-100 debt magnitude
  evidence: Record<string, unknown>;
}

export interface SmellThresholds {
  godFileLoc: number;
  godFileSymbols: number;
  godFileCyclomatic: number;
  complexFnCyclomatic: number;
  hotspotK: number; // saturation constant for the hotspot curve (higher = needs more churn×complexity to score high)
}

export const DEFAULT_THRESHOLDS: SmellThresholds = {
  godFileLoc: 400,
  godFileSymbols: 20,
  godFileCyclomatic: 50,
  complexFnCyclomatic: 15,
  hotspotK: 300,
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, Math.round(n)));
// Bands mirror Insight's proposalImpact for a consistent vocabulary across demand-side and supply-side.
function severityOf(score: number): Severity {
  return score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
}

// Detect smells across all artifacts. Files → god_file / untested_hotspot; symbols → complex_function.
export function detectSmells(metrics: ArtifactMetric[], t: SmellThresholds = DEFAULT_THRESHOLDS): SmellSpec[] {
  const smells: SmellSpec[] = [];
  for (const m of metrics) {
    if (m.kind === 'symbol') {
      // complex_function: a single FUNCTION whose cyclomatic complexity is over the threshold. Classes are
      // excluded — their cyclomatic is the SUM across methods, so a class of trivial methods would be
      // mislabeled "complex function"; class size/complexity is carried by god_file at the file level.
      if ((m.symbolKind === 'function' || m.symbolKind === 'var') && m.cyclomatic > t.complexFnCyclomatic) {
        const score = clamp((m.cyclomatic / t.complexFnCyclomatic) * 40);
        smells.push({ artifactKey: m.key, kind: 'complex_function', severity: severityOf(score), score, evidence: { cyclomatic: m.cyclomatic, loc: m.loc } });
      }
      continue;
    }
    if (m.kind !== 'file') continue;

    // god_file: large AND (many symbols OR complex). Both size and complexity must signal.
    const big = m.loc > t.godFileLoc;
    const heavy = (m.symbolCount ?? 0) > t.godFileSymbols || m.cyclomatic > t.godFileCyclomatic;
    if (big && heavy) {
      const score = clamp((m.loc / t.godFileLoc) * 30 + (m.cyclomatic / t.godFileCyclomatic) * 40);
      smells.push({ artifactKey: m.key, kind: 'god_file', severity: severityOf(score), score, evidence: { loc: m.loc, cyclomatic: m.cyclomatic, symbols: m.symbolCount ?? 0 } });
    }

    // untested_hotspot (keystone): churn × complexity × fan-in on an UNtested file. Saturating curve.
    if (m.churnCommits > 0 && !m.hasTest) {
      const raw = m.churnCommits * Math.max(1, m.cyclomatic) * (1 + m.fanIn / 5);
      const score = clamp(100 * (1 - Math.exp(-raw / t.hotspotK)));
      if (score >= 25) {
        smells.push({ artifactKey: m.key, kind: 'untested_hotspot', severity: severityOf(score), score, evidence: { churn: m.churnCommits, cyclomatic: m.cyclomatic, fan_in: m.fanIn, has_test: false } });
      }
    }
  }
  return smells;
}

// Health (0-100, higher = healthier) from the smell scores attributed to one artifact (its own + for a
// file, its symbols' complex_function scores — scan.ts does the file↔symbol attribution). Compounding.
export function healthFromSmells(scores: number[]): number {
  return clamp(100 - scores.reduce((a, b) => a + b, 0));
}
