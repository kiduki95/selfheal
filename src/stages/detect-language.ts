import { franc } from 'franc-min';

// 4.2 detectLanguage — deterministic (franc, ISO 639-3 → 639-1 매핑). 실패 시 unknown.
const MAP: Record<string, string> = {
  kor: 'ko', eng: 'en', jpn: 'ja', cmn: 'zh', spa: 'es', fra: 'fr', deu: 'de',
  rus: 'ru', por: 'pt', ita: 'it', vie: 'vi', tha: 'th', ind: 'id', arb: 'ar',
};

export function detectLanguage(text: string): { language: string; language_confidence: number } {
  const clean = text.trim();
  // franc는 짧은 텍스트에 약함 → 한글 음절 직접 감지로 보강
  if (/[가-힣]/.test(clean)) return { language: 'ko', language_confidence: 0.95 };
  if (clean.length < 10) {
    // 짧고 라틴 문자면 영어로 가정
    if (/^[\x00-\x7F]+$/.test(clean)) return { language: 'en', language_confidence: 0.6 };
    return { language: 'unknown', language_confidence: 0 };
  }
  const code3 = franc(clean, { minLength: 3 });
  if (code3 === 'und') return { language: 'unknown', language_confidence: 0 };
  const lang = MAP[code3] ?? code3;
  return { language: lang, language_confidence: 0.8 };
}
