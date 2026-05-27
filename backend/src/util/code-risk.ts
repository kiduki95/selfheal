// 경로/모듈 기반 코드 리스크 분류.
// 출처: codexstar69/bug-hunter triage.cjs (MIT) 의 zero-token 경로 휴리스틱을 이식.
// 용도: code_artifact_registry 시드 시 각 아티팩트의 위험도 tier 부여 → defect가 이 모듈에
//       매핑되면 Insight 레이어가 우선순위 가중에 사용 (결제/인증 등 critical 모듈 우선).

export type RiskTier = 'critical' | 'high' | 'medium' | 'low';

// auth/결제/암호/세션 등 — 버그 시 보안·금전 영향 최대
const CRITICAL =
  /\b(auth|security|session|token|jwt|oauth|saml|permission|acl|rbac|crypto|secret|credential|password|login|signup|register|verify|middleware|gateway|proxy|payment|billing|checkout|charge|subscription|stripe|paypal|webhook|callback)\b/i;
// api/db/queue/upload/notification 등 — 핵심 동작 경로
const HIGH =
  /\b(api|route|router|controller|handler|endpoint|resolver|service|model|schema|database|db|repository|store|state|queue|worker|job|cron|consumer|producer|cache|redis|mongo|prisma|sequelize|typeorm|knex|sql|graphql|trpc|grpc|socket|websocket|sse|stream|upload|download|file|storage|s3|email|notification|sms)\b/i;
// util/config/logger 등 — 보조 로직
const MEDIUM =
  /\b(util|utils|helper|helpers|lib|common|shared|core|config|env|logger|error|exception|validator|sanitize|transform|format|parse|convert|serialize)\b/i;

const SCORE: Record<RiskTier, number> = { critical: 90, high: 70, medium: 40, low: 10 };

// path/module/symbol/description를 합쳐 최고 매칭 tier를 반환.
export function classifyCodeRisk(...parts: (string | null | undefined)[]): { tier: RiskTier; score: number } {
  const hay = parts.filter(Boolean).join(' ');
  const tier: RiskTier = CRITICAL.test(hay) ? 'critical' : HIGH.test(hay) ? 'high' : MEDIUM.test(hay) ? 'medium' : 'low';
  return { tier, score: SCORE[tier] };
}
