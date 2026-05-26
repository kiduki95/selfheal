import { config } from '../../config.js';
import type { LlmClient } from './types.js';
import { StubLlmClient } from './stub.js';
import { AnthropicLlmClient } from './anthropic.js';
import { ClaudeCliLlmClient } from './claude-cli.js';

// 팩토리 — env로 stub/claude-cli/anthropic 선택. 파이프라인은 이 결과만 받는다.
export function makeLlmClient(): LlmClient {
  if (config.llmClient === 'claude-cli') return new ClaudeCliLlmClient(); // 구독 Claude (추가과금 0)
  if (config.llmClient === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('LLM_CLIENT=anthropic but ANTHROPIC_API_KEY is not set');
    }
    return new AnthropicLlmClient(config.anthropicApiKey);
  }
  return new StubLlmClient();
}
