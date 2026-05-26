import { createServer } from 'node:http';
import { Db } from '../src/db/db.js';
import { config } from '../src/config.js';

// 뷰 서버 — DB를 읽어 Module→Feature 지식그래프(React Flow) + 리뷰매핑/신호/gap을 보여준다.
// React Flow는 esm.sh CDN으로 브라우저에서 로드(빌드 도구·npm dep 불필요). 서버는 HTML + /api/graph(JSON) 제공.
// 마지막 run-corpus 결과 표시. `npm run ui` → http://localhost:5174
const PORT = Number(process.env.UI_PORT ?? 5174);
const db = new Db();
const REPO = config.targetRepo;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// --- React Flow 그래프 (module → component → sub-feature 트리 + floating gaps) ---
async function buildGraph() {
  const rows = await db.query<{ id: string; label: string; parent_id: string | null; reviews: string; defective: string }>(
    `SELECT f.id, f.pref_label AS label, f.parent_id,
       (SELECT count(*) FROM processed_reviews pr WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text) AS reviews,
       (SELECT count(*) FROM processed_reviews pr WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text
          AND pr.inferences->'extraction'->'feature_mapping'->>'state' = 'defective') AS defective
     FROM feature_registry f WHERE f.repo=$1 AND f.status='grounded' ORDER BY f.pref_label`,
    [REPO],
  );
  const gaps = await db.query<{ pref_label: string }>(`SELECT pref_label FROM feature_registry WHERE status='gap' AND repo=$1 ORDER BY pref_label`, [REPO]);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) (children.get(r.parent_id) ?? children.set(r.parent_id, []).get(r.parent_id)!).push(r.id);
    else roots.push(r.id);
  }
  const COL = 330, ROW = 58;
  const nodes: any[] = [];
  const edges: any[] = [];
  let y = 0;
  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    let myY: number;
    if (kids.length === 0) { myY = y * ROW; y++; }
    else { const ys = kids.map((k) => place(k, depth + 1)); myY = (ys[0]! + ys[ys.length - 1]!) / 2; }
    const r = byId.get(id)!;
    const rv = Number(r.reviews), df = Number(r.defective);
    const isLeaf = kids.length === 0;
    const style = depth === 0
      ? { background: '#0b3a52', color: '#7dd3fc', border: '1px solid #155e75', fontFamily: 'monospace', width: 190 }
      : { background: df > 0 ? '#3a1d22' : rv > 0 ? '#1e2a23' : isLeaf ? '#1d2230' : '#161a24', color: '#e6e6e6', border: `1px solid ${df > 0 ? '#ef4444' : rv > 0 ? '#3f6f55' : '#39414f'}`, width: depth === 1 ? 220 : 210 };
    nodes.push({
      id: 'f:' + id,
      position: { x: depth * COL, y: myY },
      data: { label: `${r.label}${rv ? `  ·  리뷰 ${rv}${df ? ` 🔴${df}` : ''}` : ''}` },
      style: { ...style, borderRadius: 8, fontSize: 12, padding: 8 },
    });
    for (const k of kids) edges.push({ id: `e:${id}:${k}`, source: 'f:' + id, target: 'f:' + k, style: { stroke: '#39414f' } });
    return myY;
  };
  for (const root of roots) place(root, 0);

  // floating gaps — 연결된 모듈 없이 따로 떠 있게 (Insight가 배치 제안)
  const gapX = 3 * COL + 60;
  gaps.forEach((g, i) => nodes.push({
    id: 'g:' + i,
    position: { x: gapX, y: i * ROW + 20 },
    data: { label: `🟡 ${g.pref_label}` },
    style: { background: '#2a230c', color: '#fde68a', border: '1px dashed #a16207', borderRadius: 8, fontSize: 12, width: 200, padding: 8 },
  }));
  return { nodes, edges };
}

// --- 하단 상세 (리뷰 매핑 / 신호 / gap) 서버렌더 ---
async function sectionsHtml() {
  const reviews = await db.query<any>(
    `SELECT pr.source_id, pr.category, pr.inferences->'classification'->>'severity' AS severity,
       pr.inferences->'extraction'->'feature_mapping'->>'state' AS fstate, fr.pref_label AS feature,
       pr.facts->>'text_redacted' AS text
     FROM processed_reviews pr LEFT JOIN feature_registry fr ON fr.id = (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid
     ORDER BY pr.category, pr.source_id`,
  );
  const groups = await db.query<any>(
    `SELECT g.error_signature, g.corroboration_count, g.affected_platforms, g.trend, g.status,
       (SELECT fr.pref_label FROM processed_reviews pr JOIN feature_registry fr ON fr.id=(pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid WHERE pr.signal_group_id=g.id LIMIT 1) AS feature
     FROM signal_groups g ORDER BY g.corroboration_count DESC, g.created_at`,
  );
  const badge = (s: string) => (s === 'defective' ? `<span class="b def">defective</span>` : s === 'gap' ? `<span class="b gap">gap</span>` : s === 'enhancement' ? `<span class="b enh">enhancement</span>` : s === 'grounded' ? `<span class="b grd">grounded</span>` : '');
  const rows = reviews.map((r) => `<tr><td class="mono">${esc(r.source_id)}</td><td>${esc(r.category)}${r.severity ? ` <span class="sev ${esc(r.severity)}">${esc(r.severity)}</span>` : ''}</td><td>${badge(r.fstate)} ${r.feature ? esc(r.feature) : r.fstate === 'gap' ? '<i>미구현</i>' : '—'}</td><td class="txt">${esc((r.text ?? '').slice(0, 64))}</td></tr>`).join('');
  const grps = groups.map((g) => `<div class="grp ${g.corroboration_count > 1 ? 'corro' : ''}">${g.corroboration_count > 1 ? '⭐ ' : ''}<b>${esc(g.feature ?? '?')}</b> <span class="b">${esc(g.error_signature ?? '?')}</span> · 증거 ${g.corroboration_count} · ${esc((g.affected_platforms ?? []).join(', '))} · ${esc(g.trend)}</div>`).join('');
  return `<h2>② 리뷰 → 기능 매핑 (${reviews.length})</h2><table>${rows}</table>
    <h2>③ corroborated 신호 그룹</h2>${grps || '<i>없음</i>'}`;
}

const PAGE = (sections: string) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>selfheal · feature graph</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1117;color:#e6e6e6}
  .wrap{max-width:1180px;margin:0 auto;padding:20px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#8b93a7;margin-bottom:14px}
  h2{font-size:15px;color:#aab;border-bottom:1px solid #262b38;padding-bottom:6px;margin:26px 0 12px}
  #flow{height:600px;border:1px solid #262b38;border-radius:12px;background:#0b0d13}
  .legend{display:flex;gap:14px;margin:8px 0 0;color:#8b93a7;font-size:12px;flex-wrap:wrap}
  .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}
  table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid #1e2330;vertical-align:top}
  .mono{font-family:monospace;color:#9aa;font-size:12px}.txt{color:#aab;font-size:12px}
  .b{font-size:11px;padding:1px 6px;border-radius:4px;background:#2a3142;color:#9fb}
  .b.def{background:#7f1d1d;color:#fecaca}.b.gap{background:#78550c;color:#fde68a}.b.grd{background:#14532d;color:#bbf7d0}.b.enh{background:#1e3a5f;color:#bfdbfe}
  .sev{font-size:10px;padding:0 5px;border-radius:3px;background:#333}.sev.critical{background:#7f1d1d;color:#fecaca}.sev.high{background:#7c2d12;color:#fed7aa}
  .grp{background:#161a24;border:1px solid #262b38;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13px}.grp.corro{border-color:#a16207}
</style></head><body><div class="wrap">
  <h1>selfheal · Processing Layer — feature graph</h1>
  <div class="sub">target: <b>${esc(REPO)}</b> · 코드에서 추출한 <b>모듈→기능</b> 지도 위에 리뷰를 매핑. 노란 노드 = 미구현 요청(floating gap).</div>
  <div id="flow"></div>
  <div class="legend">
    <span><span class="dot" style="background:#0b3a52;border:1px solid #155e75"></span>모듈</span>
    <span><span class="dot" style="background:#1d2230"></span>기능(리뷰 없음)</span>
    <span><span class="dot" style="background:#1e2a23"></span>기능(리뷰 있음)</span>
    <span><span class="dot" style="background:#3a1d22;border:1px solid #ef4444"></span>기능(버그 리뷰 🔴)</span>
    <span><span class="dot" style="background:#2a230c;border:1px dashed #a16207"></span>floating gap</span>
  </div>
  ${sections}
</div>
<script type="module">
  const link=document.createElement('link');link.rel='stylesheet';link.href='https://esm.sh/@xyflow/react@12/dist/style.css';document.head.appendChild(link);
  const React=await import('https://esm.sh/react@18');
  const {createRoot}=await import('https://esm.sh/react-dom@18/client');
  const RF=await import('https://esm.sh/@xyflow/react@12?deps=react@18,react-dom@18');
  const h=React.createElement;
  const g=await (await fetch('/api/graph')).json();
  function App(){
    return h('div',{style:{width:'100%',height:'100%'}},
      h(RF.ReactFlow,{defaultNodes:g.nodes,defaultEdges:g.edges,fitView:true,minZoom:0.2,proOptions:{hideAttribution:true}},
        h(RF.Background,{color:'#222838',gap:18}), h(RF.Controls,{})));
  }
  createRoot(document.getElementById('flow')).render(h(App));
</script>
</body></html>`;

createServer(async (req, res) => {
  try {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.url === '/api/graph') {
      const g = await buildGraph();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(g));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(await sectionsHtml()));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('error: ' + (e as Error).message);
  }
}).listen(PORT, () => console.log(`\n🖥  selfheal UI (React Flow) → http://localhost:${PORT}\n`));
