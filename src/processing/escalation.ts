import { thresholds } from '../config.js';

// Human-review escalation reasons derived purely from the finalized inferences + redacted text.
// Extracted so the classify stage (cache-miss) and phase1's unified post-branch (cache-hit AND miss)
// compute the SAME set — previously these lived only inside classifyExtractModerate, so a semantic
// cache hit (which skips classify) silently dropped critical/refund_legal/low_confidence escalations.

const REFUND_LEGAL = ['환불', 'refund', 'lawsuit', 'legal', '소송', '변호사', '고소', 'chargeback'];

export interface EscalationInput {
  severity: 'low' | 'medium' | 'high' | 'critical';
  categoryConfidence: number;
  text: string; // redacted original + english translation, used for refund/legal keyword scan
}

export function escalationReasons(input: EscalationInput): string[] {
  const reasons: string[] = [];
  if (input.severity === 'critical') reasons.push('critical');
  const text = input.text.toLowerCase();
  if (REFUND_LEGAL.some((k) => text.includes(k.toLowerCase()))) reasons.push('refund_legal');
  if (input.categoryConfidence < thresholds.classifyLowConf) reasons.push('low_confidence');
  return reasons;
}

// low_confidence band: above the human-queue floor but below the auto-accept ceiling.
export function isLowConfidence(categoryConfidence: number): boolean {
  return categoryConfidence >= thresholds.classifyLowConf && categoryConfidence < thresholds.classifyAccept;
}
