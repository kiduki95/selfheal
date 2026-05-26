// ============================================================
// Review Sources — registry + add flow
// ============================================================

import { Fragment, useState } from 'react';
import { Icons } from '../components/icons';
import { Card, SectionHead, Badge, Tabs, Button, Spark, SourceChip } from '../components/ui';
import { useOverlays } from '../components/overlays';
import { SOURCES } from '../data/mock';
import type { SourceKind } from '../data/mock';

export function SourcesPage() {
  const [tab, setTab] = useState('all');
  const overlays = useOverlays();
  const filtered = SOURCES.filter(s => {
    if (tab === 'own') return s.own;
    if (tab === 'comp') return !s.own;
    return true;
  });

  return (
    <Fragment>
      {/* === Overview — source health KPIs === */}
      <section className="section">
        <SectionHead eyebrow="Overview" title="At a glance" />
        <div className="l-grid">
          <Card className="col-3" pad>
            <div className="t-caps">Connected sources</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">8</div>
              <span className="badge accent dot">All healthy</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>5 own · 3 competitors</div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Reviews ingested · 7d</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">1,247</div>
              <span className="stat-delta up mono"><Icons.ArrowUp />+18%</span>
            </div>
            <div style={{ marginTop: 6 }}><Spark data={[42, 51, 64, 58, 71, 89, 95]} h={26} w={180} /></div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Avg sync interval</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">12 min</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Cron via GitHub Actions</div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Languages detected</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {([
                ['EN', 62], ['KR', 18], ['JP', 9], ['DE', 4], ['FR', 3], ['ES', 2], ['other', 2],
              ] as [string, number][]).map(([l, p]) => (
                <Badge subtle key={l}>{l} <span className="mono fg-subtle">{p}%</span></Badge>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* === Registry — sources table + add panel === */}
      <section className="section">
        <SectionHead
          eyebrow="Registry"
          title="Connected sources"
          action={
            <Button size="sm" variant="ghost" leftIcon={<Icons.Plus />} onClick={() => overlays.openAddSource()}>
              Add source
            </Button>
          }
        />
        <Tabs
          value={tab} onChange={setTab}
          items={[
            { value: 'all',  label: 'All sources',  count: SOURCES.length },
            { value: 'own',  label: 'Own product',  count: SOURCES.filter(s => s.own).length },
            { value: 'comp', label: 'Competitors',  count: SOURCES.filter(s => !s.own).length },
          ]}
        />
        <div className="l-grid">
          <Card className="col-8">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Product</th>
                  <th>Region / scope</th>
                  <th>Rate · 7d</th>
                  <th>Last sync</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <SourceChip src={s.kind} />
                        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg)' }}>{s.name}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{s.product}</span>
                        {s.own && <Badge tone="accent" subtle>own</Badge>}
                        {!s.own && <Badge tone="purple" subtle>competitor</Badge>}
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{s.region}</span></td>
                    <td className="mono">{s.rate}</td>
                    <td><span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }} className="mono">{s.lastSync}</span></td>
                    <td>
                      {s.status === 'ok' && <Badge tone="good" dot>Healthy</Badge>}
                      {s.status === 'warn' && <Badge tone="warn" dot>Slow</Badge>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" className="icon-only" onClick={() => overlays.toast({ title: 'Sync triggered', body: `${s.name} — fetching new reviews…`, icon: <Icons.Refresh /> })}><Icons.Refresh /></Button>
                        <Button size="sm" variant="ghost" className="icon-only"><Icons.More /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button size="sm" variant="ghost" leftIcon={<Icons.Plus />} onClick={() => overlays.openAddSource()}>Add source</Button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{filtered.length} of {SOURCES.length} shown</span>
            </div>
          </Card>

          <AddSourceCard className="col-4" />
        </div>
      </section>
    </Fragment>
  );
}

interface AvailableSource {
  kind: SourceKind;
  name: string;
  desc: string;
}
function AddSourceCard({ className }: { className?: string }) {
  const overlays = useOverlays();
  const SOURCES_AVAILABLE: AvailableSource[] = [
    { kind: 'appstore',  name: 'Apple App Store',     desc: 'Reviews + ratings via App Store Connect API' },
    { kind: 'playstore', name: 'Google Play',         desc: 'Reviews via Play Developer API' },
    { kind: 'reddit',    name: 'Reddit',              desc: 'Subreddit / keyword crawl' },
    { kind: 'twitter',   name: 'X / Twitter',         desc: 'Mentions & keyword search' },
    { kind: 'github',    name: 'GitHub issues',       desc: 'Listen for new issues / discussions' },
    { kind: 'intercom',  name: 'Intercom',            desc: 'Conversations & tickets' },
    { kind: 'discord',   name: 'Discord',             desc: 'Server channels via bot' },
    { kind: 'web',       name: 'Custom URL / RSS',    desc: 'Any public-facing reviews page' },
  ];
  return (
    <Card className={className} title="Add a source" action={<Button size="sm" variant="ghost" leftIcon={<Icons.Help />}>Docs</Button>}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SOURCES_AVAILABLE.map(s => (
          <div key={s.kind} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6, cursor: 'pointer' }} className="hover-row">
            <SourceChip src={s.kind} label="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--fg-strong)' }}>{s.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{s.desc}</div>
            </div>
            <Button size="sm" variant="ghost" rightIcon={<Icons.ChevRight />} onClick={() => overlays.openAddSource()}>Connect</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
