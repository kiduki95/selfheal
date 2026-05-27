import type { RawReview } from '../../contracts/raw-review.js';
import type { LlmClient } from '../../clients/llm/types.js';
import type { LlmCallRecord } from '../../contracts/processed-review.js';

// 4.0 prefilter — deterministic + (애매한 구간만) cheap LLM escalation.
// fallback: 의심스러우면 kept=true (false positive 방지 — 누락이 비용보다 비쌈).
export interface PrefilterOutput {
  kept: boolean;
  reason?: string;
  spam_score: number;
  llm_call?: LlmCallRecord;
}

export async function prefilter(review: RawReview, llm: LlmClient): Promise<PrefilterOutput> {
  const t = review.text.trim();

  // 길이 휴리스틱
  if (t.length < 1) return { kept: false, reason: 'empty', spam_score: 1 };
  if (t.length > 8000) return { kept: false, reason: 'too_long', spam_score: 0.7 };

  // 반복문자 / 단일문자 도배 / URL 폭격 / 비단어 비율
  const noSpace = t.replace(/\s/g, '');
  const uniqueRatio = noSpace.length >= 8 ? new Set(noSpace).size / noSpace.length : 1;
  const repeat = /(.)\1{7,}/.test(t);
  const urlCount = (t.match(/https?:\/\//g) ?? []).length;
  const nonWordRatio = t.replace(/[\p{L}\p{N}\s]/gu, '').length / t.length;

  let score = 0;
  if (uniqueRatio < 0.2) score += 0.85; // 단일/소수 문자 도배 (ㅋㅋㅋ…) → 명백
  else if (repeat) score += 0.5;
  if (urlCount >= 3) score += 0.85; // URL 폭격 → 명백
  else if (urlCount === 2) score += 0.4;
  if (nonWordRatio > 0.5) score += 0.5;
  score = Math.min(1, score);

  if (score >= 0.8) return { kept: false, reason: 'heuristic_spam', spam_score: Math.min(1, score) };

  // uncertainty band(0.4~0.8)만 cheap LLM escalation (spec §4.0)
  if (score >= 0.4 && score < 0.8) {
    const esc = await llm.prefilterEscalation(t);
    const call: LlmCallRecord = { stage: 'prefilter_escalation', model: esc.usage.model, tokens_in: esc.usage.tokens_in, tokens_out: esc.usage.tokens_out, cached_tokens: esc.usage.cached_tokens, duration_ms: esc.usage.duration_ms };
    if (esc.is_spam) return { kept: false, reason: 'llm_escalation_spam', spam_score: Math.max(score, 0.8), llm_call: call };
    return { kept: true, spam_score: score, llm_call: call };
  }

  return { kept: true, spam_score: score };
}
