// ============================================================
// SelfHeal — Mock data
// ============================================================
// Fictional product being monitored: "Loop" — an AI meeting
// notes & transcription SaaS. SelfHeal ingests reviews of Loop,
// maps them to Loop's repo modules, and proposes improvements.

// ----- Canonical domain types ----------------------------------------------

export interface PipelineStage {
  num: string;
  name: string;
  value: number;
  unit: string;
  sub: string;
  sparkData: number[];
}

export type SourceKind =
  | 'appstore'
  | 'playstore'
  | 'reddit'
  | 'twitter'
  | 'github'
  | 'discord'
  | 'web'
  | 'intercom';

export interface Source {
  id: string;
  kind: SourceKind;
  product: string;
  name: string;
  region: string;
  rate: number;
  lastSync: string;
  status: 'ok' | 'warn' | 'err';
  own: boolean;
}

export interface Category {
  name: string;
  count: number;
  share: number;
  trend: 'up' | 'down' | 'flat';
  pct: number;
}

export interface ActivityItem {
  kind: string;
  at: string;
  text: string;
  link: string;
}

export interface RepoModule {
  id: string;
  parent: string | null;
  label: string;
  kind: 'repo' | 'module' | 'feature' | 'orphan';
  heat: number;
  branchTag?: string;
  weight?: string;
  isOrphan?: boolean;
}

export interface GraphReview {
  src: SourceKind;
  sentiment: 'pos' | 'neg' | 'neu' | 'mix';
  rating: number | null;
  lang: string;
  text: string;
  tags: string[];
  date: string;
}

export interface Proposal {
  id: string;
  title: string;
  cluster: string;
  impacted: number;
  effort: string;
  pri: number;
  confidence: number;
  column: 'pending' | 'approved' | 'in-dev' | 'rejected';
  target: string;
  targetLabel: string;
  skill: string;
  impactScore: number;
  problem?: string;
  proposal?: string;
  expectedImpact?: string;
  sources: Record<string, number>;
  similar?: number;
  approver?: { name: string; at: string };
  rejectReason?: string;
  rejector?: { name: string; at: string };
  agent?: string;
}

export interface AgentStep {
  label: string;
  desc: string;
  state: 'done' | 'active' | 'idle' | 'failed';
  t?: string;
}

export interface AgentRun {
  id: string;
  proposal: string;
  title: string;
  branch: string;
  status: 'running' | 'review-needed' | 'failed' | 'merged';
  progress: number;
  started: string;
  eta: string;
  issue: number;
  skill: string;
  steps: AgentStep[];
  diff: { added: number; removed: number; files: number };
  pr?: { number: number; title: string; checks: number; passing: number; merged?: boolean };
  failedAt?: number;
  error?: string;
}

export interface TerminalLine {
  t: string;
  tag: string;
  msg: string;
  strong?: boolean;
}

// ----- Pipeline stats (Dashboard hero) -------------------------------------
export const PIPELINE: PipelineStage[] = [
  { num: '01', name: 'Ingestion',    value: 1247, unit: 'reviews / 7d',  sub: '8 sources active', sparkData: [42, 38, 55, 61, 48, 72, 89, 102, 95, 121] },
  { num: '02', name: 'Processing',   value: 1219, unit: 'classified',    sub: '97.7% confidence', sparkData: [40, 36, 53, 60, 47, 70, 85, 99, 92, 118] },
  { num: '03', name: 'Insights',     value: 34,   unit: 'proposals',     sub: 'this week',         sparkData: [3, 5, 2, 4, 6, 8, 6] },
  { num: '04', name: 'Approval',     value: 11,   unit: 'pending',       sub: 'in Slack',          sparkData: [2, 1, 3, 4, 2, 5, 3] },
  { num: '05', name: 'Auto-Dev',     value: 4,    unit: 'agents running',sub: '2 awaiting review', sparkData: [1, 2, 1, 3, 4, 2, 4] },
  { num: '06', name: 'PR Merged',    value: 18,   unit: 'this month',    sub: '92% test pass',     sparkData: [1, 2, 3, 2, 4, 3, 5, 6, 4, 7] },
];

// ----- Sources (Review Ingestion Layer) ------------------------------------
export const SOURCES: Source[] = [
  { id: 'src_1', kind: 'appstore',  product: 'Loop',          name: 'Loop — Meeting Notes',  region: 'US, KR, JP', rate: 312, lastSync: '2m ago', status: 'ok',    own: true },
  { id: 'src_2', kind: 'playstore', product: 'Loop',          name: 'com.loop.notes',        region: 'Global',     rate: 198, lastSync: '4m ago', status: 'ok',    own: true },
  { id: 'src_3', kind: 'reddit',    product: 'Loop',          name: 'r/productivity, r/saas',region: '—',          rate: 76,  lastSync: '11m ago',status: 'ok',    own: true },
  { id: 'src_4', kind: 'twitter',   product: 'Loop',          name: '@loopnotes mentions',   region: '—',          rate: 134, lastSync: '1m ago', status: 'ok',    own: true },
  { id: 'src_5', kind: 'intercom',  product: 'Loop',          name: 'Support tickets',       region: '—',          rate: 89,  lastSync: '6m ago', status: 'ok',    own: true },
  { id: 'src_6', kind: 'appstore',  product: 'Otter.ai',      name: 'Otter Voice Meeting',   region: 'US',         rate: 412, lastSync: '8m ago', status: 'ok',    own: false },
  { id: 'src_7', kind: 'appstore',  product: 'Fireflies',     name: 'Fireflies.ai',          region: 'US, EU',     rate: 156, lastSync: '15m ago',status: 'ok',    own: false },
  { id: 'src_8', kind: 'reddit',    product: 'Otter.ai',      name: 'r/Otter mentions',      region: '—',          rate: 23,  lastSync: '3h ago', status: 'warn', own: false },
];

// ----- Top categories ------------------------------------------------------
export const CATEGORIES: Category[] = [
  { name: 'Transcription quality', count: 312, share: 25.6, trend: 'up',   pct: 12 },
  { name: 'Feature request',       count: 247, share: 20.3, trend: 'up',   pct: 8  },
  { name: 'Integrations',          count: 184, share: 15.1, trend: 'flat', pct: 1  },
  { name: 'Performance / crash',   count: 156, share: 12.8, trend: 'down', pct: -4 },
  { name: 'Onboarding / UX',       count: 121, share: 9.9,  trend: 'down', pct: -7 },
  { name: 'Pricing',               count: 98,  share: 8.0,  trend: 'up',   pct: 3  },
  { name: 'Bug',                   count: 67,  share: 5.5,  trend: 'down', pct: -11 },
  { name: 'Other',                 count: 34,  share: 2.8,  trend: 'flat', pct: 0  },
];

// ----- Recent activity feed ------------------------------------------------
export const ACTIVITY: ActivityItem[] = [
  { kind: 'agent_done',   at: '2 min ago', text: 'Agent finished PR #1847 — feat: korean ASR fallback for noisy mic',  link: '#1847' },
  { kind: 'approved',     at: '14 min ago',text: 'Maya approved proposal P-238 in Slack — Microsoft Teams calendar integration', link: 'P-238' },
  { kind: 'insight',      at: '38 min ago',text: 'New insight cluster: 47 reviews about iPad split-view crash',         link: 'cluster_91' },
  { kind: 'rejected',     at: '1 h ago',   text: 'Daniel rejected P-235 — “out of scope for Q1 roadmap”',               link: 'P-235' },
  { kind: 'ingestion',    at: '1 h ago',   text: 'Synced 312 new reviews from App Store',                                link: 'src_1' },
  { kind: 'agent_failed', at: '2 h ago',   text: 'Agent run #1832 failed at test stage — flaky integration test in summary/bullet-points', link: '#1832' },
  { kind: 'merged',       at: '3 h ago',   text: 'PR #1841 merged — fix: summary truncation for >90 min meetings',       link: '#1841' },
  { kind: 'agent_done',   at: '4 h ago',   text: 'Agent finished PR #1839 — feat: per-speaker volume normalization',      link: '#1839' },
];

// ----- Repo modules (Processing graph) -------------------------------------
// id, parent, label, kind, heat (review count), x/y positions for tree layout
export const MODULES: RepoModule[] = [
  { id: 'root',          parent: null,          label: 'loop-app',                kind: 'repo',    heat: 1219 },

  { id: 'transcribe',    parent: 'root',        label: 'transcribe/',             kind: 'module',  heat: 312, branchTag: 'main' },
  { id: 't_ko',          parent: 'transcribe',  label: 'korean-asr',              kind: 'feature', heat: 187, weight: 'hot' },
  { id: 't_en',          parent: 'transcribe',  label: 'english-asr',             kind: 'feature', heat: 42 },
  { id: 't_dia',         parent: 'transcribe',  label: 'speaker-diarization',     kind: 'feature', heat: 56 },
  { id: 't_noise',       parent: 'transcribe',  label: 'noise-suppression',       kind: 'feature', heat: 27 },

  { id: 'summary',       parent: 'root',        label: 'summary/',                kind: 'module',  heat: 247, branchTag: 'main' },
  { id: 's_bullets',     parent: 'summary',     label: 'bullet-points',           kind: 'feature', heat: 89 },
  { id: 's_actions',     parent: 'summary',     label: 'action-items',            kind: 'feature', heat: 76 },
  { id: 's_decisions',   parent: 'summary',     label: 'decisions',               kind: 'feature', heat: 51 },
  { id: 's_translate',   parent: 'summary',     label: 'translate',               kind: 'feature', heat: 31 },

  { id: 'integrations',  parent: 'root',        label: 'integrations/',           kind: 'module',  heat: 184, branchTag: 'main' },
  { id: 'i_slack',       parent: 'integrations',label: 'slack',                   kind: 'feature', heat: 22 },
  { id: 'i_notion',      parent: 'integrations',label: 'notion',                  kind: 'feature', heat: 18 },
  { id: 'i_linear',      parent: 'integrations',label: 'linear',                  kind: 'feature', heat: 9 },
  { id: 'i_gcal',        parent: 'integrations',label: 'google-calendar',         kind: 'feature', heat: 14 },

  { id: 'mobile',        parent: 'root',        label: 'mobile/',                 kind: 'module',  heat: 156, branchTag: 'main' },
  { id: 'm_ios',         parent: 'mobile',      label: 'ios',                     kind: 'feature', heat: 91 },
  { id: 'm_android',     parent: 'mobile',      label: 'android',                 kind: 'feature', heat: 49 },
  { id: 'm_ipad',        parent: 'mobile',      label: 'ipad',                    kind: 'feature', heat: 16 },

  { id: 'collab',        parent: 'root',        label: 'collab/',                 kind: 'module',  heat: 89, branchTag: 'main' },
  { id: 'c_share',       parent: 'collab',      label: 'sharing',                 kind: 'feature', heat: 34 },
  { id: 'c_comment',     parent: 'collab',      label: 'comments',                kind: 'feature', heat: 19 },

  { id: 'auth',          parent: 'root',        label: 'auth/',                   kind: 'module',  heat: 34 },
  { id: 'a_sso',         parent: 'auth',        label: 'sso',                     kind: 'feature', heat: 21 },

  // Orphans — clusters we couldn't map to existing code
  { id: 'orphan_teams',  parent: null,          label: 'ms-teams-integration',    kind: 'orphan',  heat: 64, isOrphan: true },
  { id: 'orphan_offline',parent: null,          label: 'offline-mode',            kind: 'orphan',  heat: 42, isOrphan: true },
  { id: 'orphan_widget', parent: null,          label: 'ios-widget',              kind: 'orphan',  heat: 28, isOrphan: true },
];

// ----- Reviews (for graph side panel) --------------------------------------
export const REVIEWS: Record<string, GraphReview[]> = {
  t_ko: [
    { src: 'appstore', sentiment: 'neg', rating: 1, lang: 'KR', text: '한국어 인식이 진짜 너무 별로예요. 회의실에서 쓰면 거의 알아듣질 못함.', tags: ['accuracy', 'noise'], date: '2h' },
    { src: 'playstore', sentiment: 'neg', rating: 2, lang: 'KR', text: 'Korean transcription confuses speakers when 2+ people talk over each other.', tags: ['diarization'], date: '5h' },
    { src: 'twitter',  sentiment: 'neg', rating: null, lang: 'EN', text: 'Loop\'s Korean ASR is unusable in meetings >5 people. Reverting to Otter.', tags: ['churn-risk'], date: '8h' },
    { src: 'reddit',   sentiment: 'mix', rating: null, lang: 'EN', text: 'Korean works ok if everyone has a mic, but conference room audio is rough.', tags: ['noise'], date: '12h' },
    { src: 'intercom', sentiment: 'neg', rating: null, lang: 'KR', text: '저희 팀 한국어 회의에서 인식률이 60% 정도밖에 안 나오는데 개선 계획이 있는지요?', tags: ['accuracy'], date: '1d' },
  ],
  orphan_teams: [
    { src: 'twitter', sentiment: 'pos', rating: null, lang: 'EN', text: 'Loving Loop but we live in Microsoft Teams. Any plan for Teams calendar/bot integration?', tags: ['feature-request'], date: '3h' },
    { src: 'intercom', sentiment: 'neu', rating: null, lang: 'EN', text: 'Hi team — when will Microsoft Teams be supported? Our enterprise has standardized on it.', tags: ['enterprise'], date: '6h' },
    { src: 'reddit',   sentiment: 'pos', rating: null, lang: 'EN', text: 'Switched from Otter, only thing missing is Teams. Slack/Notion is great though.', tags: ['feature-request'], date: '11h' },
  ],
  s_bullets: [
    { src: 'appstore', sentiment: 'mix', rating: 3, lang: 'EN', text: 'Bullet summaries are great for 30min meetings but truncate for longer ones.', tags: ['truncation'], date: '4h' },
    { src: 'intercom', sentiment: 'neg', rating: null, lang: 'EN', text: 'Our 2hr quarterly review came out as 4 bullets total. Useless.', tags: ['truncation'], date: '9h' },
  ],
};

// ----- Insight / Proposal cards --------------------------------------------
export const PROPOSALS: Proposal[] = [
  {
    id: 'P-241',
    title: 'Korean ASR fallback to denoised audio path for noisy mics',
    cluster: 'cluster_91',
    impacted: 12345,
    effort: '2–3 wks',
    pri: 0,
    confidence: 0.88,
    column: 'pending',
    target: 't_ko',
    targetLabel: 'transcribe/korean-asr',
    skill: 'claude-opus-4-7',
    impactScore: 92,
    problem: 'Korean transcription accuracy drops to ~62% in conference-room audio. 187 reviews & 24 churn-risk mentions in 7 days.',
    proposal: 'Wire a denoised audio path into the Korean ASR pipeline when input SNR < 12dB. Falls back gracefully; no UX change.',
    expectedImpact: '+18–24% accuracy on conference audio; ~7% reduction in negative reviews for transcription category.',
    sources: { appstore: 89, reddit: 14, twitter: 32, intercom: 52 },
    similar: 3,
  },
  {
    id: 'P-238',
    title: 'Microsoft Teams calendar & meeting bot integration',
    cluster: 'cluster_88',
    impacted: 8420,
    effort: '4–6 wks',
    pri: 1,
    confidence: 0.91,
    column: 'pending',
    target: 'orphan_teams',
    targetLabel: '(new module) integrations/ms-teams',
    skill: 'claude-opus-4-7',
    impactScore: 84,
    problem: '64 enterprise asks in 30d — biggest blocker for SMB→Enterprise expansion per Sales notes.',
    proposal: 'New integrations/ms-teams module: OAuth, calendar sync, meeting bot, post-meeting Loop card.',
    expectedImpact: 'Unblocks ~$140k ARR in stalled enterprise deals; net-new acquisition lift est. 6–9%.',
    sources: { intercom: 41, twitter: 13, reddit: 10 },
    similar: 1,
  },
  {
    id: 'P-237',
    title: 'Long-meeting summary chunking (>90min)',
    cluster: 'cluster_84',
    impacted: 4120,
    effort: '1 wk',
    pri: 1,
    confidence: 0.94,
    column: 'approved',
    target: 's_bullets',
    targetLabel: 'summary/bullet-points',
    skill: 'claude-sonnet-4-6',
    impactScore: 71,
    problem: 'Summary truncation reported in 89 reviews — affects every quarterly/board call.',
    proposal: 'Sliding-window chunking with overlap merge. Cap bullets at 18, group by topic.',
    expectedImpact: '~95% of long meetings produce useful summaries vs. current 38%.',
    sources: { intercom: 51, appstore: 28, reddit: 10 },
    similar: 0,
    approver: { name: 'Maya Ortiz', at: '14m ago' },
  },
  {
    id: 'P-236',
    title: 'iPad split-view crash on rotation',
    cluster: 'cluster_92',
    impacted: 1280,
    effort: '3 days',
    pri: 0,
    confidence: 0.97,
    column: 'in-dev',
    target: 'm_ipad',
    targetLabel: 'mobile/ipad',
    skill: 'claude-sonnet-4-6',
    impactScore: 64,
    problem: 'Hard crash when iPad rotates during recording in split view. Reproducible on iPadOS 17.4+.',
    proposal: 'Hold AudioSession across rotation; defer UIKit resize until recording stabilizes.',
    expectedImpact: 'Removes #2 crash bucket in App Store reviews.',
    sources: { appstore: 91, intercom: 21 },
    similar: 0,
    approver: { name: 'Daniel Kim', at: '2h ago' },
    agent: 'agent_1847',
  },
  {
    id: 'P-235',
    title: 'Allow custom summary templates per team',
    cluster: 'cluster_79',
    impacted: 3200,
    effort: '6+ wks',
    pri: 2,
    confidence: 0.72,
    column: 'rejected',
    target: 'summary',
    targetLabel: 'summary/',
    skill: 'claude-opus-4-7',
    impactScore: 48,
    rejectReason: 'Out of scope for Q1 — overlaps with workspace-templates RFC already in design (Issue #2104).',
    rejector: { name: 'Daniel Kim', at: '1h ago' },
    sources: { reddit: 42, intercom: 18, twitter: 6 },
  },
  {
    id: 'P-234',
    title: 'Per-speaker volume normalization',
    cluster: 'cluster_77',
    impacted: 2840,
    effort: '1 wk',
    pri: 1,
    confidence: 0.89,
    column: 'in-dev',
    target: 't_dia',
    targetLabel: 'transcribe/speaker-diarization',
    skill: 'claude-sonnet-4-6',
    impactScore: 58,
    proposal: 'Compute per-speaker target loudness post-diarization, apply gain before re-mix.',
    sources: { appstore: 38, intercom: 22, reddit: 7 },
    agent: 'agent_1839',
  },
  {
    id: 'P-232',
    title: 'iOS home-screen widget for last meeting',
    cluster: 'cluster_72',
    impacted: 1900,
    effort: '2 wks',
    pri: 2,
    confidence: 0.81,
    column: 'pending',
    target: 'orphan_widget',
    targetLabel: '(new feature) ios/widgets',
    skill: 'claude-sonnet-4-6',
    impactScore: 42,
    sources: { appstore: 19, reddit: 9 },
  },
  {
    id: 'P-231',
    title: 'Offline mode for transcription playback',
    cluster: 'cluster_71',
    impacted: 4800,
    effort: '4 wks',
    pri: 1,
    confidence: 0.79,
    column: 'pending',
    target: 'orphan_offline',
    targetLabel: '(new module) offline/',
    skill: 'claude-opus-4-7',
    impactScore: 67,
    sources: { reddit: 18, appstore: 15, intercom: 9 },
  },
];

// ----- Agent runs ----------------------------------------------------------
export const AGENTS: AgentRun[] = [
  {
    id: 'agent_1847',
    proposal: 'P-236',
    title: 'iPad split-view crash on rotation',
    branch: 'fix/p-236-ipad-rotation-crash',
    status: 'running',
    progress: 0.62,
    started: '14 min ago',
    eta: '~6 min',
    issue: 1847,
    skill: 'claude-sonnet-4-6 · loop-app',
    steps: [
      { label: 'Analyze issue & plan',    desc: 'Parsed 21 reviews, ranked 3 plausible root causes', state: 'done', t: '+0:02' },
      { label: 'Create branch',           desc: 'fix/p-236-ipad-rotation-crash from main @ a3f9c1d',  state: 'done', t: '+0:04' },
      { label: 'Locate & read code',      desc: 'mobile/ipad/AudioSessionCoordinator.swift +3 files', state: 'done', t: '+1:12' },
      { label: 'Write fix',               desc: '4 files changed · +127 −38',                          state: 'done', t: '+4:30' },
      { label: 'Run tests',               desc: 'AudioSessionCoordinatorTests.swift · 8 / 8 passed',   state: 'active', t: '+5:50' },
      { label: 'Commit & push',           desc: '',                                                    state: 'idle' },
      { label: 'Open PR',                 desc: '',                                                    state: 'idle' },
    ],
    diff: { added: 127, removed: 38, files: 4 },
  },
  {
    id: 'agent_1839',
    proposal: 'P-234',
    title: 'Per-speaker volume normalization',
    branch: 'feat/p-234-speaker-volume-norm',
    status: 'review-needed',
    progress: 1.0,
    started: '47 min ago',
    eta: 'PR open',
    issue: 1839,
    skill: 'claude-sonnet-4-6 · loop-app',
    pr: { number: 1839, title: 'feat: per-speaker volume normalization', checks: 8, passing: 8 },
    steps: [
      { label: 'Analyze issue & plan',    desc: 'Identified 2 reasonable approaches; picked post-diarization gain', state: 'done' },
      { label: 'Create branch',           desc: 'feat/p-234-speaker-volume-norm',                                    state: 'done' },
      { label: 'Locate & read code',      desc: 'transcribe/speaker-diarization · 6 files',                          state: 'done' },
      { label: 'Write code',              desc: '7 files changed · +389 −41',                                        state: 'done' },
      { label: 'Run tests',               desc: '23 / 23 passed · 87% coverage on new module',                       state: 'done' },
      { label: 'Commit & push',           desc: 'a8c3d11 · 3 commits',                                               state: 'done' },
      { label: 'Open PR',                 desc: '#1839 · 8 / 8 checks passing',                                      state: 'done' },
    ],
    diff: { added: 389, removed: 41, files: 7 },
  },
  {
    id: 'agent_1832',
    proposal: 'P-229',
    title: 'Notion sync respects nested page permissions',
    branch: 'fix/p-229-notion-perms',
    status: 'failed',
    progress: 0.55,
    started: '2h ago',
    eta: 'Failed',
    issue: 1832,
    skill: 'claude-sonnet-4-6 · loop-app',
    failedAt: 4,
    steps: [
      { label: 'Analyze issue & plan',    desc: '', state: 'done' },
      { label: 'Create branch',           desc: '', state: 'done' },
      { label: 'Locate & read code',      desc: '', state: 'done' },
      { label: 'Write code',              desc: '5 files changed · +201 −67', state: 'done' },
      { label: 'Run tests',               desc: 'integrations/notion/sync_test.ts:128 — flaky timing assert', state: 'failed' },
      { label: 'Commit & push',           desc: '', state: 'idle' },
      { label: 'Open PR',                 desc: '', state: 'idle' },
    ],
    diff: { added: 201, removed: 67, files: 5 },
    error: 'Test failure: 1 / 22 (NotionSync.respectsPermissions — likely flaky timing)',
  },
  {
    id: 'agent_1841',
    proposal: 'P-230',
    title: 'Summary truncation for >90min meetings',
    branch: 'fix/p-230-summary-truncation',
    status: 'merged',
    progress: 1.0,
    started: '3h ago',
    eta: 'Merged',
    issue: 1841,
    skill: 'claude-sonnet-4-6 · loop-app',
    pr: { number: 1841, title: 'fix: summary truncation for >90min meetings', checks: 8, passing: 8, merged: true },
    steps: [
      { label: 'Analyze issue & plan',    desc: '', state: 'done' },
      { label: 'Create branch',           desc: '', state: 'done' },
      { label: 'Locate & read code',      desc: '', state: 'done' },
      { label: 'Write code',              desc: '', state: 'done' },
      { label: 'Run tests',               desc: '', state: 'done' },
      { label: 'Commit & push',           desc: '', state: 'done' },
      { label: 'Open PR',                 desc: '', state: 'done' },
    ],
    diff: { added: 94, removed: 31, files: 3 },
  },
];

// ----- Terminal log lines (agent variant) ---------------------------------
export const TERMINAL_LINES: TerminalLine[] = [
  { t: '14:32:08', tag: 'plan',    msg: 'Reading issue #1847 — "iPad split-view crash on rotation"' },
  { t: '14:32:09', tag: 'plan',    msg: 'Loaded 21 linked reviews from cluster_92 (last 7 days)' },
  { t: '14:32:14', tag: 'plan',    msg: 'Ranked 3 root cause hypotheses. Top: AudioSession invalidation during UIKit resize. (p=0.81)' },
  { t: '14:32:18', tag: 'git',     msg: 'Created branch fix/p-236-ipad-rotation-crash from main @ a3f9c1d' },
  { t: '14:32:24', tag: 'read',    msg: 'mobile/ipad/AudioSessionCoordinator.swift (lines 1–284)' },
  { t: '14:32:26', tag: 'read',    msg: 'mobile/ipad/RecordingViewController.swift (lines 88–212)' },
  { t: '14:32:29', tag: 'read',    msg: 'mobile/shared/AVAudioSessionExtensions.swift' },
  { t: '14:33:42', tag: 'edit',    msg: 'AudioSessionCoordinator.swift — hold session across viewWillTransitionToSize' },
  { t: '14:34:11', tag: 'edit',    msg: 'RecordingViewController.swift — defer UIKit resize until session stable' },
  { t: '14:35:30', tag: 'edit',    msg: 'Wrote AudioSessionCoordinatorTests.swift +120 LOC' },
  { t: '14:36:48', tag: 'test',    msg: 'xcodebuild test -scheme LoopiOS -destination "iPad Pro 13"' },
  { t: '14:37:55', tag: 'test',    msg: 'AudioSessionCoordinatorTests — 8 / 8 passed (1.4s)', strong: true },
  { t: '14:38:01', tag: 'test',    msg: 'Running full test suite... (eta ~2m)' },
];
