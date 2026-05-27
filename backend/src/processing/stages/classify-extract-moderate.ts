import type { LlmClient, ClassifyInput, ClassifyOutput } from '../../clients/llm/types.js';
import { escalationReasons, isLowConfidence } from '../escalation.js';

// 4.6 classifyExtractModerate — 단일 LLM 호출(+graduated escalation). 비-confidence 트리거로
// 사람 큐로 보낼지 판단하는 플래그도 계산 (spec §4.6). 실제 reason 도출은 escalation.ts의 순수
// 함수를 공유 — phase1이 cache-hit/miss 양쪽에서 같은 규칙으로 재계산한다.
export interface ClassifyStageOutput {
  result: ClassifyOutput;
  low_confidence: boolean; // 0.6 ≤ conf < 0.85
  human_review_reasons: string[]; // 'critical' | 'refund_legal' | 'low_confidence'
}

export async function classifyExtractModerate(input: ClassifyInput, llm: LlmClient): Promise<ClassifyStageOutput> {
  const result = await llm.classifyExtractModerate(input);
  const conf = result.classification.category_confidence;
  return {
    result,
    low_confidence: isLowConfidence(conf),
    human_review_reasons: escalationReasons({
      severity: result.classification.severity,
      categoryConfidence: conf,
      text: `${input.text_redacted} ${input.text_en ?? ''}`,
    }),
  };
}
