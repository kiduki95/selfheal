// 4.1 normalize — deterministic. NFC, 공백/줄바꿈 정리, zero-width/제어문자 제거. LLM 0.
// 정규식은 코드포인트로 조립 — 소스에 리터럴 제어/zero-width 문자를 넣지 않는다.
const cc = String.fromCharCode;
const ZERO_WIDTH = new RegExp('[' + cc(0x200b) + '-' + cc(0x200d) + cc(0xfeff) + ']', 'g');
// C0(0x00-0x1F)·DEL·C1(0x7F-0x9F) 제어문자 제거하되 \t(09) \n(0A) \r(0D)는 보존
const CONTROL = new RegExp(
  '[' + cc(0x00) + '-' + cc(0x08) + cc(0x0b) + cc(0x0c) + cc(0x0e) + '-' + cc(0x1f) + cc(0x7f) + '-' + cc(0x9f) + ']',
  'g',
);

export function normalize(text: string): { text_normalized: string } {
  const out = text
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text_normalized: out };
}
