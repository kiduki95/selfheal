// PSI (Population Stability Index) — drift 감지 (spec §8). KL은 신규 KO/EN 토큰/카테고리에
// 과민해 false alarm → PSI(bucketed) 권장. baseline 분포 대비 current 분포의 안정성.
//   PSI < 0.1  : 안정 (shift 없음)
//   0.1~0.25   : moderate shift
//   > 0.25     : significant shift → 조사 (단, "drift ≠ action" — confidence-health 확인 후 tiered)

export function psi(baseline: Record<string, number>, current: Record<string, number>): number {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const bTotal = sum(baseline) || 1;
  const cTotal = sum(current) || 1;
  const eps = 1e-6;
  let total = 0;
  for (const k of keys) {
    const b = Math.max((baseline[k] ?? 0) / bTotal, eps);
    const c = Math.max((current[k] ?? 0) / cTotal, eps);
    total += (c - b) * Math.log(c / b);
  }
  return Math.round(total * 1000) / 1000;
}

export function psiLabel(value: number): 'stable' | 'moderate' | 'significant' {
  if (value < 0.1) return 'stable';
  if (value < 0.25) return 'moderate';
  return 'significant';
}

function sum(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}
