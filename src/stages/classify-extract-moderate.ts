import type { LlmClient, ClassifyInput, ClassifyOutput } from '../clients/llm/types.js';
import { thresholds } from '../config.js';

// 4.6 classifyExtractModerate — 단일 LLM 호출(+graduated escalation). 비-confidence 트리거로
// 사람 큐로 보낼지 판단하는 플래그도 계산 (spec §4.6).
export interface ClassifyStageOutput {
  result: ClassifyOutput;
  low_confidence: boolean; // 0.6 ≤ conf < 0.85
  human_review_reasons: string[]; // 'critical' | 'refund_legal' | 'low_confidence'
}

const REFUND_LEGAL = ['환불', 'refund', 'lawsuit', 'legal', '소송', '변호사', '고소', 'chargeback'];

export async function classifyExtractModerate(input: ClassifyInput, llm: LlmClient): Promise<ClassifyStageOutput> {
  const result = await llm.classifyExtractModerate(input);
  const conf = result.classification.category_confidence;
  const reasons: string[] = [];

  if (result.classification.severity === 'critical') reasons.push('critical');
  const text = `${input.text_redacted} ${input.text_en ?? ''}`.toLowerCase();
  if (REFUND_LEGAL.some((k) => text.includes(k.toLowerCase()))) reasons.push('refund_legal');
  // escalation 후에도 여전히 낮으면 사람에게
  if (conf < thresholds.classifyLowConf) reasons.push('low_confidence');

  return {
    result,
    low_confidence: conf >= thresholds.classifyLowConf && conf < thresholds.classifyAccept,
    human_review_reasons: reasons,
  };
}
