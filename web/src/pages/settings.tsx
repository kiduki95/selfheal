// ============================================================
// Settings — integrations, infrastructure, schedules, team
// ============================================================

import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { Icons, type IconName } from '../components/icons';
import { Card, SectionHead, Badge, Button, SourceChip, Switch } from '../components/ui';
import { useOverlays } from '../components/overlays';

interface SettingsSection {
  key: string;
  label: string;
  icon: IconName;
}

export function SettingsPage() {
  const [section, setSection] = useState('integrations');

  const SECTIONS: SettingsSection[] = [
    { key: 'integrations', label: 'Integrations',   icon: 'Link' },
    { key: 'providers',    label: 'AI providers',   icon: 'Sparkles' },
    { key: 'pipeline',     label: 'Pipeline & skills', icon: 'Robot' },
    { key: 'schedule',     label: 'Schedules',      icon: 'Calendar' },
    { key: 'infra',        label: 'Infrastructure', icon: 'Database' },
    { key: 'team',         label: 'Team & access',  icon: 'Layers' },
    { key: 'keys',         label: 'API keys',       icon: 'Cog' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22, minHeight: 'calc(100vh - 100px)' }}>
      {/* Left rail */}
      <aside>
        <div className="page-title" style={{ marginBottom: 4 }}>Settings</div>
        <div className="page-sub" style={{ marginBottom: 18 }}>Workspace · Loop</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {SECTIONS.map(s => {
            const Ic = Icons[s.icon];
            return (
              <div
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`nav-item ${section === s.key ? 'active' : ''}`}
                style={{ position: 'static' }}
              >
                <span className="nav-ico"><Ic /></span>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right content */}
      <div>
        {section === 'integrations' && <IntegrationsSection />}
        {section === 'providers'    && <ProvidersSection />}
        {section === 'pipeline'     && <PipelineSection />}
        {section === 'schedule'     && <ScheduleSection />}
        {section === 'infra'        && <InfraSection />}
        {section === 'team'         && <TeamSection />}
        {section === 'keys'         && <KeysSection />}
      </div>
    </div>
  );
}

// SectionHeader is replaced by SectionHead from ui.tsx + per-tab section/l-grid structure.

// ----- Integrations --------------------------------------------------------
interface Integration {
  key: string;
  name: string;
  status: 'connected' | 'disconnected';
  desc: string;
  meta?: string;
  logo?: ReactNode;
  icon: ReactNode;
}
function IntegrationsSection() {
  const INTS: Integration[] = [
    { key: 'slack',  name: 'Slack',  status: 'connected',
      desc: 'Proposal cards posted to #selfheal-review. Approve, reject, comment from Slack.',
      meta: 'Loop workspace · #selfheal-review · 3 channels active',
      logo: <SourceChip src="reddit" label="" />, icon: <Icons.Slack /> },
    { key: 'github', name: 'GitHub',  status: 'connected',
      desc: 'Repo connected for module mapping. Auto-Dev opens PRs on approval.',
      meta: 'loop/loop-app · main · branch protection on',
      icon: <Icons.Github /> },
    { key: 'linear', name: 'Linear',  status: 'connected',
      desc: 'Mirror approved proposals to Linear issues for sprint planning.',
      meta: 'team: Loop Eng · project: Self-improving',
      icon: <Icons.Layers /> },
    { key: 'pd',     name: 'PagerDuty', status: 'disconnected',
      desc: 'Alert on-call when agent failures exceed threshold.',
      icon: <Icons.Bell /> },
    { key: 'sentry', name: 'Sentry',  status: 'disconnected',
      desc: 'Cross-reference crash reports with review clusters.',
      icon: <Icons.AlertTri /> },
  ];
  return (
    <Fragment>
      {/* === Slack approval flow === */}
      <section className="section">
        <SectionHead
          eyebrow="Integrations"
          title="Slack — approval flow"
          action={<Badge tone="good" dot>Connected</Badge>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Icons.Slack />
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-strong)' }}>Slack — approval flow</div>
                  <Badge tone="good" dot style={{ marginLeft: 'auto' }}>Connected</Badge>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.55, marginBottom: 14 }}>
                  SelfHeal posts proposal cards to your team's channel. Reviewers can <code className="mono">Approve</code>, <code className="mono">Reject</code> or <code className="mono">Request changes</code> directly in Slack. Reject reasons are remembered.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Setting label="Workspace" value="Loop HQ" valueMono />
                  <Setting label="Default channel" value="#selfheal-review" valueMono />
                  <Setting label="Mention reviewers" value="@product-leads, @eng-leads" />
                  <Setting label="Post threshold" value="Only proposals with confidence ≥ 0.7" />
                  <Setting label="Daily digest" value="09:00 KST · #selfheal-digest" />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                  <Button leftIcon={<Icons.Eye />}>Preview message</Button>
                  <Button variant="ghost" leftIcon={<Icons.Pencil />}>Edit channels</Button>
                  <Button variant="ghost" leftIcon={<Icons.External />}>Slack admin</Button>
                </div>
              </div>

              {/* Slack preview */}
              <div style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div className="t-caps" style={{ marginBottom: 8 }}>Slack preview</div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: 'linear-gradient(135deg, var(--accent), var(--accent-press))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--accent-fg)' }}>S</div>
                    <span style={{ fontWeight: 600, color: 'var(--fg-strong)' }}>SelfHeal</span>
                    <Badge subtle style={{ fontSize: 9 }}>APP</Badge>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)', marginLeft: 'auto' }}>09:14</span>
                  </div>
                  <div style={{ paddingLeft: 22, color: 'var(--fg)' }}>
                    <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
                      <div style={{ fontWeight: 500, color: 'var(--fg-strong)', marginBottom: 4 }}>P-241 · Korean ASR fallback</div>
                      <div style={{ color: 'var(--fg-muted)', lineHeight: 1.45 }}>12,345 users · 2–3 wks · P0</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                        <div className="btn primary sm">Approve</div>
                        <div className="btn sm" style={{ color: 'var(--danger)' }}>Reject</div>
                        <div className="btn sm">View</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* === Other integrations === */}
      <section className="section">
        <SectionHead
          eyebrow="External"
          title="Other integrations"
          action={<span className="t-caps" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Slack and GitHub required</span>}
        />
        <div className="l-grid">
          <Card className="col-12" title="Other integrations">
            <div>
              {INTS.slice(1).map(it => (
                <div key={it.key} className="list-row">
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {it.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{it.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{it.desc}</div>
                    {it.meta && <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 3 }} className="mono">{it.meta}</div>}
                  </div>
                  {it.status === 'connected'
                    ? <Badge tone="good" dot>Connected</Badge>
                    : <Badge subtle>Disconnected</Badge>}
                  {it.status === 'connected'
                    ? <Button size="sm" variant="ghost" leftIcon={<Icons.Cog />}>Configure</Button>
                    : <Button size="sm" leftIcon={<Icons.Plus />}>Connect</Button>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

interface SettingProps {
  label: ReactNode;
  value: ReactNode;
  valueMono?: boolean;
  hint?: ReactNode;
}
function Setting({ label, value, valueMono, hint }: SettingProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-strong)' }} className={valueMono ? 'mono' : ''}>{value}</div>
    </div>
  );
}

// ----- Pipeline & skills ---------------------------------------------------
interface SkillRow {
  stage: string;
  model: string;
  desc: string;
  cost: string;
}
function PipelineSection() {
  const SKILLS: SkillRow[] = [
    { stage: '1. Filter',         model: 'claude-haiku-4-5', desc: 'Spam / ads / noise removal · cost-optimized', cost: '$0.002 / 1k reviews' },
    { stage: '2. Classify',       model: 'claude-sonnet-4-6', desc: 'Category + sentiment + priority',           cost: '$0.018 / 1k reviews' },
    { stage: '3. Cluster',        model: 'voyage-3 + pgvector', desc: 'Embeddings + k-means · weekly',           cost: '$0.005 / 1k reviews' },
    { stage: '4. Insights',       model: 'claude-opus-4-7',  desc: 'Generates proposal cards from clusters',     cost: '$0.31 / cluster' },
    { stage: '5. Auto-Dev agent', model: 'claude-sonnet-4-6', desc: 'Plans, edits, runs tests, opens PR',         cost: '$1.20 / PR avg' },
  ];
  return (
    <Fragment>
      {/* === Stage skills table === */}
      <section className="section">
        <SectionHead
          eyebrow="Pipeline"
          title="Pipeline & skills"
          action={<Button variant="primary" leftIcon={<Icons.Plus />}>Add custom skill</Button>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Model</th>
                  <th>Behaviour</th>
                  <th>Est. cost</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SKILLS.map(s => (
                  <tr key={s.stage}>
                    <td><span className="mono" style={{ fontSize: 12 }}>{s.stage}</span></td>
                    <td><Badge tone="purple" subtle><Icons.Sparkles />{s.model}</Badge></td>
                    <td><span style={{ fontSize: 12, color: 'var(--fg)' }}>{s.desc}</span></td>
                    <td><span className="mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.cost}</span></td>
                    <td><Badge tone="good" dot>Active</Badge></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />}>Prompt</Button>
                        <Button size="sm" variant="ghost" className="icon-only"><Icons.More /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* === Cost & guardrails === */}
      <section className="section">
        <SectionHead eyebrow="Controls" title="Optimization & guardrails" />
        <div className="l-grid">
          <Card className="col-6" title="Cost optimization">
            <div className="card-pad">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ToggleRow on label="Prompt caching" desc="Re-use system prompts. Saves ~90% on filter/classify stages." />
                <ToggleRow on label="Batch API" desc="Bundle non-urgent inference for ~50% discount." />
                <ToggleRow on={false} label="Spot inference window" desc="Run heavy stages only between 02:00–06:00 KST." />
              </div>
            </div>
          </Card>
          <Card className="col-6" title="Guardrails">
            <div className="card-pad">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ToggleRow on label="Stop at PR" desc="Auto-Dev never merges. Human review always required." />
                <ToggleRow on label="Feature flag new modules" desc="Auto-create feature flag for orphan clusters." />
                <ToggleRow on label="Test coverage gate" desc="Reject PRs that lower coverage below 75%." />
                <ToggleRow on={false} label="Auto-retry failed agents" desc="Re-plan and retry up to 2 times on failure." />
              </div>
            </div>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

interface ToggleRowProps {
  on: boolean;
  label: ReactNode;
  desc: ReactNode;
}
function ToggleRow({ on, label, desc }: ToggleRowProps) {
  const [v, setV] = useState(on);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{desc}</div>
      </div>
      <Switch on={v} onChange={setV} />
    </div>
  );
}

// ----- Schedules -----------------------------------------------------------
function ScheduleSection() {
  return (
    <Fragment>
      <section className="section">
        <SectionHead
          eyebrow="Schedules"
          title="Pipeline schedules"
          action={<span className="t-caps" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>When SelfHeal runs each stage</span>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <ScheduleRow stage="Review ingestion"   cadence="every 10 min"  detail="Continuous polling via API · cron" enabled />
              <ScheduleRow stage="Classification"     cadence="streaming"     detail="Triggered per-review on ingestion" enabled />
              <ScheduleRow stage="Clustering"         cadence="every 6h"      detail="Re-embed and re-cluster · last run 2h 18m ago" enabled />
              <ScheduleRow stage="Insight generation" cadence="Weekly · Mon 09:00 KST" detail="Opus on top clusters · ~$8 / week" enabled />
              <ScheduleRow stage="Slack digest"       cadence="Daily · 09:00 KST"      detail="Summary of yesterday's review trends" enabled />
            </div>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

interface ScheduleRowProps {
  stage: ReactNode;
  cadence: ReactNode;
  detail: ReactNode;
  enabled: boolean;
}
function ScheduleRow({ stage, cadence, detail, enabled }: ScheduleRowProps) {
  const [v, setV] = useState(enabled);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 200px 1fr auto auto', alignItems: 'center', gap: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{stage}</div>
      <Badge subtle><Icons.Calendar />{cadence}</Badge>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{detail}</div>
      <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />}>Edit</Button>
      <Switch on={v} onChange={setV} />
    </div>
  );
}

// ----- Infrastructure ------------------------------------------------------
function InfraSection() {
  return (
    <Fragment>
      <section className="section">
        <SectionHead
          eyebrow="Infrastructure"
          title="Storage & observability"
          action={<span className="t-caps" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Where SelfHeal stores reviews, embeddings, and logs</span>}
        />
        <div className="l-grid">
          <InfraCard
            className="col-6"
            icon={<Icons.Database />}
            title="Vector DB"
            desc="Stores embeddings of every review for clustering and similarity search."
            rows={[
              ['Provider',   'pgvector (Postgres)'],
              ['Region',     'ap-northeast-2 (Seoul)'],
              ['Vectors',    '1,247,318'],
              ['Dimension',  '1024 · voyage-3'],
            ]}
          />
          <InfraCard
            className="col-6"
            icon={<Icons.Folder />}
            title="Raw storage"
            desc="Immutable copy of every ingested review. Used to re-cluster on prompt changes."
            rows={[
              ['Provider', 'AWS S3'],
              ['Bucket',   'loop-selfheal-raw'],
              ['Region',   'ap-northeast-2'],
              ['Retention','Forever (lifecycle to glacier after 90d)'],
            ]}
          />
          <InfraCard
            className="col-6"
            icon={<Icons.Activity />}
            title="Observability"
            desc="Token usage, latency, error rates per stage."
            rows={[
              ['Provider',     'Datadog'],
              ['Logs',         '~14 GB / day'],
              ['Alerts',       '3 active'],
              ['Dashboard',    'selfheal-overview'],
            ]}
          />
          <InfraCard
            className="col-6"
            icon={<Icons.Cog />}
            title="Secrets"
            desc="API keys for review sources, Slack bot, GitHub app, Anthropic."
            rows={[
              ['Manager',  'AWS Secrets Manager'],
              ['Keys',     '14 stored'],
              ['Rotation', 'Quarterly (auto)'],
              ['Audit',    'CloudTrail · all access logged'],
            ]}
          />
        </div>
      </section>
    </Fragment>
  );
}

interface InfraCardProps {
  icon: ReactNode;
  title: ReactNode;
  desc: ReactNode;
  rows: string[][];
  className?: string;
}
function InfraCard({ icon, title, desc, rows, className }: InfraCardProps) {
  return (
    <Card className={className}>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
          {icon}
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</div>
          <Badge tone="good" dot style={{ marginLeft: 'auto' }}>OK</Badge>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 12 }}>{desc}</div>
        <div>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{k}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Button size="sm" variant="ghost" leftIcon={<Icons.External />}>Open in console</Button>
          <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />}>Configure</Button>
        </div>
      </div>
    </Card>
  );
}

// ----- Team ----------------------------------------------------------------
function TeamSection() {
  const TEAM = [
    { name: 'Maya Ortiz',    role: 'Admin',     email: 'maya@loop.app',    can: 'all',     last: 'online' },
    { name: 'Daniel Kim',    role: 'Reviewer',  email: 'daniel@loop.app',  can: 'approve', last: '2 h ago' },
    { name: 'Priya Shah',    role: 'Reviewer',  email: 'priya@loop.app',   can: 'approve', last: '1 d ago' },
    { name: 'Sam Chen',      role: 'Engineer',  email: 'sam@loop.app',     can: 'agent',   last: '4 h ago' },
    { name: 'Ava Lindgren',  role: 'Read-only', email: 'ava@loop.app',     can: 'view',    last: '5 d ago' },
  ];
  return (
    <Fragment>
      <section className="section">
        <SectionHead
          eyebrow="Team"
          title="Team & access"
          action={<Button variant="primary" leftIcon={<Icons.Plus />}>Invite member</Button>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <table className="table">
              <thead><tr><th>Member</th><th>Role</th><th>Permissions</th><th>Last seen</th><th></th></tr></thead>
              <tbody>
                {TEAM.map(m => (
                  <tr key={m.email}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div className="avatar" style={{ background: m.role === 'Admin' ? 'linear-gradient(135deg, var(--accent), var(--accent-press))' : 'linear-gradient(135deg, var(--purple), var(--pink))' }}>{m.name.split(' ').map(x=>x[0]).join('')}</div>
                        <div>
                          <div style={{ fontSize: 12.5, color: 'var(--fg-strong)' }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }} className="mono">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge subtle>{m.role}</Badge></td>
                    <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{m.can}</span></td>
                    <td><span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{m.last}</span></td>
                    <td><Button size="sm" variant="ghost" className="icon-only"><Icons.More /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

// ----- API keys ------------------------------------------------------------
function KeysSection() {
  const KEYS = [
    { name: 'Anthropic API',           value: 'sk-ant-…7f3a', scope: 'pipeline · all stages',    rotated: '14 d ago' },
    { name: 'Apple — App Store Connect', value: 'jwt · …a13b', scope: 'ingestion · App Store',    rotated: '32 d ago' },
    { name: 'Google Play Developer',   value: 'json · …c91e', scope: 'ingestion · Play',         rotated: '32 d ago' },
    { name: 'Reddit API',              value: 'rdt-…99f1',   scope: 'ingestion · Reddit',       rotated: '21 d ago' },
    { name: 'Slack bot token',         value: 'xoxb-…482e',  scope: 'approval flow',            rotated: '47 d ago' },
    { name: 'GitHub App',              value: 'gha-…1b8c',   scope: 'mapping + auto-dev',       rotated: '60 d ago' },
  ];
  return (
    <Fragment>
      <section className="section">
        <SectionHead
          eyebrow="API keys"
          title="Service credentials"
          action={<Button variant="primary" leftIcon={<Icons.Plus />}>Add key</Button>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <table className="table">
              <thead><tr><th>Service</th><th>Value</th><th>Used by</th><th>Last rotated</th><th></th></tr></thead>
              <tbody>
                {KEYS.map(k => (
                  <tr key={k.name}>
                    <td><span style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{k.name}</span></td>
                    <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{k.value}</span></td>
                    <td><span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{k.scope}</span></td>
                    <td><span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{k.rotated}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" leftIcon={<Icons.Refresh />}>Rotate</Button>
                        <Button size="sm" variant="ghost" className="icon-only"><Icons.More /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

// ============================================================
// AI providers (Claude / Codex API + local CLIs)
// ============================================================
interface ProviderUsage {
  req: string;
  tok: string;
  cost: string;
}
interface Provider {
  id: string;
  name: string;
  kind: 'api' | 'cli';
  desc: string;
  status: 'connected' | 'disconnected' | 'detected' | 'missing';
  logo: ReactNode;
  meta?: string;
  key?: string;
  base?: string;
  models?: string[];
  usage?: ProviderUsage;
  binary?: string;
  version?: string;
  detected?: string;
  cwd?: string;
  sandbox?: string;
}

interface StageRoute {
  provider: string;
  model: string;
}
type RoutingState = Record<'filter' | 'classify' | 'embed' | 'insights' | 'autodev', StageRoute>;

function ProvidersSection() {
  const overlays = useOverlays();
  const [openProvider, setOpenProvider] = useState<Provider | null>(null);

  const API_PROVIDERS: Provider[] = [
    {
      id: 'anthropic',
      name: 'Anthropic API',
      kind: 'api',
      desc: 'Used for filter, classify, insights, and Auto-Dev agents.',
      status: 'connected',
      key: 'sk-ant-… 7f3a',
      base: 'https://api.anthropic.com/v1',
      models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
      logo: <Icons.Sparkles />,
      meta: 'Prompt caching on · 7-day TTL · $0.18 / 1M cached tokens',
      usage: { req: '47.2k req / 24h', tok: '12.4M tok', cost: '$184 / mo' },
    },
    {
      id: 'openai',
      name: 'OpenAI / Codex API',
      kind: 'api',
      desc: 'Optional — enable to compare against GPT models or use Codex for code edits.',
      status: 'connected',
      key: 'sk-proj-… 9b22',
      base: 'https://api.openai.com/v1',
      models: ['gpt-5.1-codex', 'gpt-5.1-pro', 'gpt-5.1-mini', 'o4-pro'],
      logo: <Icons.Code />,
      meta: 'Batch API on · 50% discount · EU region pinning',
      usage: { req: '8.1k req / 24h', tok: '2.7M tok', cost: '$38 / mo' },
    },
    {
      id: 'voyage',
      name: 'Voyage AI',
      kind: 'api',
      desc: 'Embeddings for clustering (voyage-3, 1024-dim).',
      status: 'connected',
      key: 'pa-… 4f81',
      base: 'https://api.voyageai.com/v1',
      models: ['voyage-3', 'voyage-3-lite'],
      logo: <Icons.Layers />,
      meta: 'Embeddings cached · pgvector store',
      usage: { req: '1.2M tok / 24h', tok: '—', cost: '$6 / mo' },
    },
    {
      id: 'bedrock',
      name: 'AWS Bedrock',
      kind: 'api',
      desc: 'Run Anthropic models through Bedrock for VPC-bound inference.',
      status: 'disconnected',
      logo: <Icons.Database />,
      meta: 'Useful for compliance / SOC 2 strict workloads',
    },
  ];

  const CLI_PROVIDERS: Provider[] = [
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      kind: 'cli',
      desc: 'Use the local claude binary to run Auto-Dev agents on the host machine.',
      status: 'connected',
      binary: '/usr/local/bin/claude',
      version: 'claude-code 1.8.4',
      detected: '6 min ago',
      cwd: '/workspace/loop-app',
      sandbox: 'docker · selfheal-runner:1.4',
      logo: <Icons.Code />,
      meta: 'Uses your local ANTHROPIC_API_KEY · inherits .claude/settings.json',
      usage: { req: '14 runs / 24h', tok: '—', cost: 'local' },
    },
    {
      id: 'codex-cli',
      name: 'Codex CLI',
      kind: 'cli',
      desc: 'OpenAI Codex CLI — alternative agent runtime for code tasks.',
      status: 'connected',
      binary: '/usr/local/bin/codex',
      version: 'codex-cli 0.42.1',
      detected: '6 min ago',
      cwd: '/workspace/loop-app',
      sandbox: 'docker · selfheal-runner:1.4',
      logo: <Icons.Code />,
      meta: 'Uses your local OPENAI_API_KEY · reads ~/.codex/config.toml',
      usage: { req: '3 runs / 24h', tok: '—', cost: 'local' },
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      kind: 'cli',
      desc: 'Google\'s gemini-cli — not yet configured on this host.',
      status: 'detected',
      binary: '/opt/homebrew/bin/gemini',
      version: 'gemini-cli 0.9.0',
      detected: '6 min ago',
      logo: <Icons.Code />,
      meta: 'Detected on $PATH · click to enable',
    },
    {
      id: 'aider',
      name: 'aider',
      kind: 'cli',
      desc: 'Pair-programming CLI — currently not installed.',
      status: 'missing',
      logo: <Icons.Code />,
      meta: 'Not on $PATH · install via brew or pip then click rescan',
    },
  ];

  // Stage routing — which provider serves which pipeline stage
  const [routing] = useState<RoutingState>({
    filter:   { provider: 'anthropic', model: 'claude-haiku-4-5' },
    classify: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embed:    { provider: 'voyage',    model: 'voyage-3' },
    insights: { provider: 'anthropic', model: 'claude-opus-4-7' },
    autodev:  { provider: 'claude-code', model: 'claude-sonnet-4-6 (via CLI)' },
  });

  return (
    <Fragment>
      {/* === Hosted APIs === */}
      <section className="section">
        <SectionHead
          eyebrow="AI providers"
          title="Hosted APIs"
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" leftIcon={<Icons.Refresh />} onClick={() => overlays.toast({ title: 'Re-scanning $PATH', body: 'Found 2 CLIs in 1.2s · 1 detected, 1 missing', icon: <Icons.Refresh /> })}>Re-scan local CLIs</Button>
              <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => overlays.toast({ title: 'Provider wizard', body: 'Choose between API endpoint, OAuth, or local binary', icon: <Icons.Plus /> })}>Add provider</Button>
            </div>
          }
        />
        <div className="l-grid">
          {API_PROVIDERS.map(p => (
            <ProviderCard key={p.id} p={p} onOpen={() => setOpenProvider(p)} className="col-6" />
          ))}
        </div>
      </section>

      {/* === Local CLIs === */}
      <section className="section">
        <SectionHead
          eyebrow="AI providers"
          title="Local CLIs"
          action={<Badge tone="info" subtle><Icons.Database />host: ip-10-0-32-118.ap-northeast-2</Badge>}
        />
        <div className="l-grid">
          {CLI_PROVIDERS.map(p => (
            <ProviderCard key={p.id} p={p} onOpen={() => setOpenProvider(p)} className="col-6" />
          ))}
        </div>
      </section>

      {/* === Per-stage routing === */}
      <section className="section">
        <SectionHead
          eyebrow="Routing"
          title="Per-stage routing"
          action={<Button size="sm" variant="ghost" leftIcon={<Icons.Refresh />} onClick={() => overlays.toast({ title: 'Reset routing', body: 'All stages back to defaults (Anthropic + Voyage)', icon: <Icons.Refresh /> })}>Reset to defaults</Button>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Why</th>
                  <th>Est. cost / 1k items</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <RoutingRow stage="Filter"            r={routing.filter}   why="Cheapest model, high recall on spam."      cost="$0.002" />
                <RoutingRow stage="Classify"          r={routing.classify} why="Sonnet hits 96% F1 on category/sentiment." cost="$0.018" />
                <RoutingRow stage="Embed (cluster)"   r={routing.embed}    why="Voyage-3 outperforms text-embedding-3."    cost="$0.005" />
                <RoutingRow stage="Insights"          r={routing.insights} why="Opus reasons over full clusters."           cost="$0.31 / cluster" />
                <RoutingRow stage="Auto-Dev agent"    r={routing.autodev}  why="Local CLI keeps repo on host · zero egress." cost="local · 0.4 GB egress / run" highlight />
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* === Health stats === */}
      <section className="section">
        <SectionHead eyebrow="Health" title="Provider health" />
        <div className="l-grid">
          <HealthStat className="col-3" label="Provider uptime · 30d" v="99.94%" sub="Anthropic only — 1 incident" />
          <HealthStat className="col-3" label="Local CLI runs"       v="17 / 17" sub="All succeeded · sandbox: docker" />
          <HealthStat className="col-3" label="Egress (auto-dev)"     v="0 GB"   sub="CLI keeps repo on host" tone="accent" />
          <HealthStat className="col-3" label="Monthly est."          v="$228"   sub="API $222 · CLI compute on host" />
        </div>
      </section>

      {openProvider && (
        <ProviderDetailModal p={openProvider} onClose={() => setOpenProvider(null)} />
      )}
    </Fragment>
  );
}

// ----- Provider card -------------------------------------------------------
interface ProviderCardProps {
  p: Provider;
  onOpen: () => void;
  className?: string;
}
function ProviderCard({ p, onOpen, className }: ProviderCardProps) {
  const tone: 'accent' | 'good' | 'warn' | 'danger' | null =
    p.status === 'connected' ? 'good' :
    p.status === 'detected'  ? 'warn'   :
    p.status === 'missing'   ? 'danger' :
    null;
  const label =
    p.status === 'connected'    ? 'Connected' :
    p.status === 'detected'     ? 'Detected, not enabled' :
    p.status === 'missing'      ? 'Not installed' :
    'Disconnected';

  return (
    <div className={`card${className ? ` ${className}` : ''}`} onClick={onOpen} style={{ cursor: 'pointer', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: p.kind === 'cli' ? 'var(--info-soft)' : 'var(--accent-soft)',
          color: p.kind === 'cli' ? 'var(--info)' : 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{p.logo}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{p.name}</span>
            <Badge subtle style={{ fontSize: 9 }}>{p.kind.toUpperCase()}</Badge>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.desc}</div>
        </div>
        {tone
          ? <Badge tone={tone} dot={p.status === 'connected'} subtle={p.status !== 'connected'}>{label}</Badge>
          : <Badge subtle>{label}</Badge>}
      </div>

      {/* Specifics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, background: 'var(--bg-soft)', borderRadius: 6 }}>
        {p.kind === 'api' && p.status === 'connected' && (
          <Fragment>
            <DataRow k="API key"  v={p.key}  mono mask />
            <DataRow k="Endpoint" v={p.base} mono />
            <DataRow k="Models"   v={
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(p.models ?? []).map(m => <Badge subtle key={m} style={{ fontSize: 10 }}><Icons.Sparkles />{m}</Badge>)}
              </div>
            } />
          </Fragment>
        )}
        {p.kind === 'cli' && (p.status === 'connected' || p.status === 'detected') && (
          <Fragment>
            <DataRow k="Binary"   v={p.binary}  mono />
            <DataRow k="Version"  v={p.version} mono />
            {p.cwd && <DataRow k="Working dir" v={p.cwd} mono />}
            {p.sandbox && <DataRow k="Sandbox" v={p.sandbox} />}
          </Fragment>
        )}
        {p.status === 'missing' && (
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{p.meta}</div>
        )}
        {p.status === 'disconnected' && p.kind === 'api' && (
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{p.meta}</div>
        )}
      </div>

      {p.usage && p.status === 'connected' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '4px 2px' }}>
          <UsagePill l="Requests" v={p.usage.req} />
          <UsagePill l="Tokens"   v={p.usage.tok} />
          <UsagePill l="Cost"     v={p.usage.cost} />
        </div>
      )}

      {p.meta && p.status === 'connected' && (
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icons.Lightning />{p.meta}
        </div>
      )}
    </div>
  );
}

interface DataRowProps {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
  mask?: boolean;
}
function DataRow({ k, v, mono, mask }: DataRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, padding: '2px 0', alignItems: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{k}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 11.5, color: 'var(--fg)' }}>
        {v}
        {mask && <Button size="sm" variant="ghost" className="icon-only" style={{ marginLeft: 6, height: 18, width: 18 }} title="Reveal"><Icons.Eye /></Button>}
      </div>
    </div>
  );
}

interface UsagePillProps {
  l: ReactNode;
  v: ReactNode;
}
function UsagePill({ l, v }: UsagePillProps) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 4, padding: '5px 8px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: 0.04 }}>{l}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-strong)' }}>{v}</div>
    </div>
  );
}

interface HealthStatProps {
  label: ReactNode;
  v: ReactNode;
  sub: ReactNode;
  tone?: string;
  className?: string;
}
function HealthStat({ label, v, sub, tone, className }: HealthStatProps) {
  return (
    <Card pad className={className}>
      <div className="t-caps">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 500 }} className={`mono ${tone === 'good' ? 'fg-good' : tone === 'accent' ? 'fg-accent' : 'fg-strong'}`}>{v}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>{sub}</div>
    </Card>
  );
}

// ----- Routing row ---------------------------------------------------------
interface RoutingRowProps {
  stage: string;
  r: StageRoute;
  why: ReactNode;
  cost: ReactNode;
  highlight?: boolean;
}
function RoutingRow({ stage, r, why, cost, highlight }: RoutingRowProps) {
  const overlays = useOverlays();
  const isCli = r.provider === 'claude-code' || r.provider === 'codex-cli';
  const provLabel =
    r.provider === 'anthropic'   ? 'Anthropic API' :
    r.provider === 'openai'      ? 'OpenAI / Codex API' :
    r.provider === 'voyage'      ? 'Voyage AI' :
    r.provider === 'claude-code' ? 'Claude Code CLI' :
    r.provider === 'codex-cli'   ? 'Codex CLI' :
    r.provider;
  return (
    <tr style={highlight ? { background: 'var(--accent-soft)' } : undefined}>
      <td><span style={{ fontSize: 13, color: 'var(--fg-strong)', fontWeight: 500 }}>{stage}</span></td>
      <td>
        <Badge tone={isCli ? 'info' : 'accent'} subtle>
          {isCli ? <Icons.Code /> : <Icons.Sparkles />}
          {provLabel}
        </Badge>
      </td>
      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--fg)' }}>{r.model}</span></td>
      <td><span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{why}</span></td>
      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{cost}</span></td>
      <td>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />} onClick={() => overlays.toast({ title: 'Change provider', body: `Pick a different provider for ${stage}`, icon: <Icons.Pencil /> })}>Change</Button>
          <Button size="sm" variant="ghost" leftIcon={<Icons.Play />} onClick={() => overlays.toast({ title: `Test ${stage}`, body: `Sample 5 items · ${provLabel} · ~3s`, icon: <Icons.Check /> })}>Test</Button>
        </div>
      </td>
    </tr>
  );
}

// ----- Provider detail modal ----------------------------------------------
interface ProviderDetailModalProps {
  p: Provider;
  onClose: () => void;
}
function ProviderDetailModal({ p, onClose }: ProviderDetailModalProps) {
  const overlays = useOverlays();
  const isCli = p.kind === 'cli';
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{
        width: 640, maxWidth: '94vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: isCli ? 'var(--info-soft)' : 'var(--accent-soft)',
            color: isCli ? 'var(--info)' : 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{p.logo}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>{p.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{p.desc}</div>
          </div>
          <Button variant="ghost" className="icon-only" onClick={onClose}><Icons.X /></Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px' }}>
          {/* API config */}
          {p.kind === 'api' && (
            <Fragment>
              <div className="t-caps" style={{ marginBottom: 8 }}>Connection</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FormRow2 label="API key">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input mono" defaultValue={p.key || ''} style={{ flex: 1 }} />
                    <Button variant="ghost" leftIcon={<Icons.Eye />}>Reveal</Button>
                  </div>
                </FormRow2>
                <FormRow2 label="Base URL" hint="Override for self-hosted gateways (LiteLLM, Vercel AI Gateway, etc.)">
                  <input className="input mono" defaultValue={p.base || ''} />
                </FormRow2>
                <FormRow2 label="Region pinning" hint="Send requests through a specific region.">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge tone="accent" subtle>any</Badge>
                    <Badge subtle>us-east-1</Badge>
                    <Badge subtle>eu-west-1</Badge>
                    <Badge subtle>ap-northeast-2</Badge>
                  </div>
                </FormRow2>
                <FormRow2 label="Prompt caching" hint="Cache long system prompts · saves ~90% on filter/classify.">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Switch on={true} onChange={() => {}} />
                    <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Enabled</span>
                  </div>
                </FormRow2>
                <FormRow2 label="Available models">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(p.models || []).map(m => <Badge tone="purple" subtle key={m}><Icons.Sparkles />{m}</Badge>)}
                  </div>
                </FormRow2>
              </div>
            </Fragment>
          )}

          {/* CLI config */}
          {p.kind === 'cli' && (
            <Fragment>
              <div className="t-caps" style={{ marginBottom: 8 }}>Local binary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FormRow2 label="Binary path" hint="Override $PATH detection if needed.">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input mono" defaultValue={p.binary || ''} style={{ flex: 1 }} />
                    <Button variant="ghost" leftIcon={<Icons.Refresh />} onClick={() => overlays.toast({ title: 'Probing binary', body: `${p.binary} — ok · v${(p.version || '').split(' ').pop()}`, icon: <Icons.Check /> })}>Probe</Button>
                  </div>
                </FormRow2>
                <FormRow2 label="Detected version">
                  <Badge subtle><Icons.Code /><span className="mono">{p.version || 'unknown'}</span></Badge>
                </FormRow2>
                <FormRow2 label="Working directory" hint="Where the CLI is invoked. Usually your monorepo root.">
                  <input className="input mono" defaultValue={p.cwd || '/workspace/loop-app'} />
                </FormRow2>
                <FormRow2 label="Sandbox" hint="How the CLI is isolated when running an Auto-Dev task.">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge tone="accent" subtle>docker</Badge>
                    <Badge subtle>firecracker</Badge>
                    <Badge subtle>host (⚠️)</Badge>
                  </div>
                </FormRow2>
                <FormRow2 label="Inherit auth" hint="Reuse credentials the CLI already has on this host.">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" defaultChecked /> Reuse local ANTHROPIC_API_KEY / OPENAI_API_KEY
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" defaultChecked /> Load .claude / .codex config files
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" /> Allow network egress from sandbox
                    </label>
                  </div>
                </FormRow2>
                <FormRow2 label="Concurrency" hint="Max simultaneous Auto-Dev runs.">
                  <input className="input mono" defaultValue="2" style={{ width: 80 }} />
                </FormRow2>
              </div>

              <div className="t-caps" style={{ marginTop: 22, marginBottom: 8 }}>Test run</div>
              <div style={{
                padding: 10, background: '#050608', borderRadius: 6,
                fontFamily: 'Geist Mono', fontSize: 11, lineHeight: 1.6, color: '#a3a3a3',
              }}>
                <div><span style={{ color: 'var(--fg-subtle)' }}>$</span> <span style={{ color: '#ededed' }}>{p.binary} --version</span></div>
                <div style={{ color: '#777' }}>{p.version}</div>
                <div style={{ marginTop: 8 }}><span style={{ color: 'var(--fg-subtle)' }}>$</span> <span style={{ color: '#ededed' }}>{(p.binary || '').split('/').pop()} --print "hello"</span></div>
                <div style={{ color: 'var(--accent)' }}>✓ 200 OK · 142 tok in / 36 tok out · 0.8s</div>
              </div>
            </Fragment>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--bg-soft)' }}>
          {p.status === 'missing' && (
            <Fragment>
              <Button variant="ghost" leftIcon={<Icons.External />}>Install instructions</Button>
              <Button variant="primary" leftIcon={<Icons.Refresh />} onClick={() => overlays.toast({ title: 'Re-scanning $PATH', body: 'No new binaries found' })}>Rescan</Button>
            </Fragment>
          )}
          {p.status === 'detected' && (
            <Fragment>
              <Button variant="ghost" leftIcon={<Icons.X />} onClick={onClose}>Cancel</Button>
              <span style={{ flex: 1 }} />
              <Button variant="primary" leftIcon={<Icons.Check />} onClick={() => { overlays.toast({ title: 'Provider enabled', body: `${p.name} · ready to route stages to it`, icon: <Icons.Check /> }); onClose(); }}>Enable</Button>
            </Fragment>
          )}
          {p.status === 'connected' && (
            <Fragment>
              <Button variant="danger" leftIcon={<Icons.X />} onClick={() => overlays.confirm({
                title: `Disconnect ${p.name}?`,
                body: 'Any stage routed through this provider will fall back to defaults.',
                danger: true, confirmLabel: 'Disconnect',
                onConfirm: () => { overlays.toast({ title: 'Disconnected', body: `${p.name} removed from routing` }); onClose(); },
              })}>Disconnect</Button>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" leftIcon={<Icons.Play />} onClick={() => overlays.toast({ title: `Test ${p.name}`, body: '✓ 200 OK · 142 tok in / 36 tok out · 0.8s', icon: <Icons.Check /> })}>Test connection</Button>
              <Button variant="primary" leftIcon={<Icons.Check />} onClick={() => { overlays.toast({ title: 'Saved', body: `${p.name} updated`, icon: <Icons.Check /> }); onClose(); }}>Save</Button>
            </Fragment>
          )}
          {p.status === 'disconnected' && (
            <Fragment>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <span style={{ flex: 1 }} />
              <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => { overlays.toast({ title: 'Connected', body: `${p.name} ready`, icon: <Icons.Check /> }); onClose(); }}>Connect</Button>
            </Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

interface FormRow2Props {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}
function FormRow2({ label, hint, children }: FormRow2Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
