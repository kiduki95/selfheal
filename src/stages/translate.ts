import type { LlmClient } from '../clients/llm/types.js';
import type { LlmCallRecord } from '../contracts/processed-review.js';

// 4.5 translate — conditional (language !== 'en'). Haiku 4.5 (stub일 땐 가짜).
export async function translate(
  textRedacted: string,
  language: string,
  llm: LlmClient,
): Promise<{ text_en: string | null; llm_call?: LlmCallRecord }> {
  if (language === 'en' || language === 'unknown') return { text_en: null };
  const out = await llm.translate({ text_redacted: textRedacted, language });
  return {
    text_en: out.text_en,
    llm_call: { stage: 'translate', model: out.usage.model, tokens_in: out.usage.tokens_in, tokens_out: out.usage.tokens_out, cached_tokens: out.usage.cached_tokens, duration_ms: out.usage.duration_ms },
  };
}
