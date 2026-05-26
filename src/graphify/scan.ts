import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, sep } from 'node:path';

// graphify T1 parse (graphify-layer.md §4) — TypeScript Compiler API로 결정론 추출 (Claude 0).
// tree-sitter 대신 이미 있는 `typescript` 의존성 사용 → 네이티브 빌드 없이 크로스플랫폼.
// .ts/.tsx 다중 소스루트 지원 (Next.js app/components/lib/hooks 등). 산출: module/file/symbol
// 노드 + contains/imports 엣지 + 모듈→기능(feature) 후보.

export type NodeKind = 'module' | 'file' | 'symbol';

export interface ArtifactNode {
  key: string;
  kind: NodeKind;
  path: string;
  module: string;
  symbol: string | null;
  symbolKind?: string; // 'function'|'class'|'var'|'interface'|'type'|'enum'
  signature: string | null;
  description: string;
  contentHash: string;
}
export interface EdgeSpec {
  srcKey: string;
  dstKey: string;
  kind: 'contains' | 'imports' | 'provides';
}
export interface FeatureSpec {
  slug: string;
  pref_label: string;
  description: string;
  memberKeys: string[];
  parentSlug?: string; // 컴포넌트 feature는 모듈 feature를 parent로 (SKOS broader)
  level: 'module' | 'component';
}
export interface ScanResult {
  repo: string;
  ref: string;
  nodes: ArtifactNode[];
  edges: EdgeSpec[];
  features: FeatureSpec[];
}
export interface ScanOptions {
  rootDir: string;
  repo: string;
  ref?: string;
  srcDirs?: string[]; // 미지정 시 자동감지
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', 'public', 'styles', '.github']);
const SRC_CANDIDATES = ['src', 'app', 'components', 'lib', 'hooks', 'pages', 'server'];

export function scanRepo(opts: ScanOptions): ScanResult {
  const root = opts.rootDir;
  const srcDirs = opts.srcDirs ?? SRC_CANDIDATES.filter((d) => existsSync(join(root, d)));

  const files = srcDirs
    .flatMap((d) => walkCode(join(root, d)))
    .filter((f) => !f.endsWith('.d.ts') && !/\.(test|spec)\.(ts|tsx)$/.test(f));

  const nodes: ArtifactNode[] = [];
  const edges: EdgeSpec[] = [];
  const fileKeyByPath = new Map<string, string>();
  const fileModule = new Map<string, string>(); // fileKey → module
  const moduleMembers = new Map<string, string[]>();
  const importPairs: { fromFile: string; toRel: string }[] = [];
  const moduleSet = new Set<string>();

  for (const abs of files) {
    const relPath = toPosix(relative(root, abs));
    const module = moduleOf(toPosix(relative(root, dirname(abs))));
    moduleSet.add(module);
    const text = readFileSync(abs, 'utf8');
    const fileKey = relPath;
    fileKeyByPath.set(relPath, fileKey);
    fileModule.set(fileKey, module);

    nodes.push({
      key: fileKey,
      kind: 'file',
      path: relPath,
      module,
      symbol: null,
      signature: null,
      description: card(relPath, module, null, null, fileLeadingComment(text)),
      contentHash: sha(relPath + text),
    });
    pushMember(moduleMembers, module, fileKey);

    const kind = abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        if (spec.startsWith('.')) importPairs.push({ fromFile: relPath, toRel: resolveImport(relPath, spec) });
        continue;
      }
      if (!isExported(stmt)) continue;
      for (const sym of declaredSymbols(stmt, sf)) {
        const symKey = `${relPath}#${sym.name}`;
        nodes.push({
          key: symKey,
          kind: 'symbol',
          path: relPath,
          module,
          symbol: sym.name,
          symbolKind: sym.kind,
          signature: sym.signature,
          description: card(relPath, module, sym.name, sym.signature, sym.doc),
          contentHash: sha(symKey + sym.signature),
        });
        edges.push({ srcKey: fileKey, dstKey: symKey, kind: 'contains' });
        pushMember(moduleMembers, module, symKey);
      }
    }
  }

  // module 노드 + module→file contains
  for (const module of moduleSet) {
    const modKey = `module:${module}`;
    nodes.push({
      key: modKey,
      kind: 'module',
      path: module,
      module,
      symbol: null,
      signature: null,
      description: card(module, module, null, null, `module ${module}`),
      contentHash: sha('module:' + module),
    });
  }
  for (const [fileKey, module] of fileModule) {
    edges.push({ srcKey: `module:${module}`, dstKey: fileKey, kind: 'contains' });
  }

  // imports 엣지 (해소되는 것만)
  for (const { fromFile, toRel } of importPairs) {
    for (const cand of [toRel, toRel.replace(/\.tsx$/, '.ts'), toRel.replace(/\.ts$/, '.tsx'), `${toRel.replace(/\.(ts|tsx)$/, '')}/index.ts`, `${toRel.replace(/\.(ts|tsx)$/, '')}/index.tsx`]) {
      const dst = fileKeyByPath.get(cand);
      if (dst) {
        edges.push({ srcKey: fromFile, dstKey: dst, kind: 'imports' });
        break;
      }
    }
  }

  // feature description에 멤버 심볼명을 넣어 매핑 판단(Claude-as-judge)의 재료 제공.
  // 모듈경로(components/dashboard)만으론 사용자어(차트)와 안 이어지지만, 심볼(StockGraph)이 다리.
  const symbolsByModule = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.kind === 'symbol' && n.symbol) pushMember(symbolsByModule, n.module, n.symbol);
  }
  const slugify = (m: string) => `code.${m.replace(/[\/]/g, '.')}`;
  // 모듈 feature (coarse, parent) — 뷰 계층용. 앵커=모듈 노드.
  const moduleFeatures: FeatureSpec[] = [...moduleSet].map((module) => {
    const syms = (symbolsByModule.get(module) ?? []).slice(0, 14);
    return {
      slug: slugify(module),
      pref_label: module,
      description: `${module} 모듈. 구성요소: ${syms.join(', ') || '(no exports)'}`,
      memberKeys: [`module:${module}`],
      level: 'module' as const,
    };
  });
  // 컴포넌트 feature (leaf) — 매칭/grounding의 실제 단위. 앵커=특정 심볼+파일 노드. parent=모듈.
  const componentFeatures: FeatureSpec[] = nodes
    .filter(isFeatureWorthy)
    .map((n) => ({
      slug: `${slugify(n.module)}.${n.symbol}`,
      pref_label: n.symbol!,
      description: `${n.symbol} (${n.module}/${n.path.split('/').pop()}). ${n.signature ?? ''}`,
      memberKeys: [n.key, n.path], // 심볼 노드 + 파일 노드 → 파일 단위 grounding
      parentSlug: slugify(n.module),
      level: 'component' as const,
    }));
  const features: FeatureSpec[] = [...moduleFeatures, ...componentFeatures];

  return { repo: opts.repo, ref: opts.ref ?? 'workdir', nodes, edges, features };
}

// --- helpers ---
function walkCode(dir: string): string[] {
  let out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkCode(p));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// dir(repo 상대) → module. 선행 'src' 제거 후 최대 2단계. (예: src/clients/llm→clients/llm,
// app/dashboard→app/dashboard, components/ui→components/ui, lib→lib, src→core)
function moduleOf(dirRelToRoot: string): string {
  let parts = toPosix(dirRelToRoot).split('/').filter(Boolean);
  if (parts[0] === 'src') parts = parts.slice(1);
  if (parts.length === 0) return 'core';
  return parts.slice(0, 2).join('/');
}

function isExported(node: ts.Node): boolean {
  const mods = (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined) ?? [];
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

interface SymInfo {
  name: string;
  signature: string;
  doc: string;
  kind: string;
}
function declaredSymbols(stmt: ts.Statement, sf: ts.SourceFile): SymInfo[] {
  const doc = leadingComment(sf.text, stmt.getFullStart());
  const sig = firstLine(sf.text.slice(stmt.getStart(sf), stmt.getEnd()));
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return [{ name: stmt.name.text, signature: sig, doc, kind: 'function' }];
  if (ts.isClassDeclaration(stmt) && stmt.name) return [{ name: stmt.name.text, signature: sig, doc, kind: 'class' }];
  if (ts.isInterfaceDeclaration(stmt)) return [{ name: stmt.name.text, signature: `interface ${stmt.name.text}`, doc, kind: 'interface' }];
  if (ts.isTypeAliasDeclaration(stmt)) return [{ name: stmt.name.text, signature: `type ${stmt.name.text}`, doc, kind: 'type' }];
  if (ts.isEnumDeclaration(stmt)) return [{ name: stmt.name.text, signature: `enum ${stmt.name.text}`, doc, kind: 'enum' }];
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations
      .filter((d) => ts.isIdentifier(d.name))
      .map((d) => ({ name: (d.name as ts.Identifier).text, signature: firstLine(sf.text.slice(d.getStart(sf), d.getEnd())), doc, kind: 'var' }));
  }
  return [];
}

// "사용자 대면 기능다운" 심볼 판정 — leaf feature 승격 대상 (graphify ① finer features).
// PascalCase 컴포넌트/클래스/페이지만; ui 프리미티브·타입·유틸·Next 노이즈 제외.
const EXCLUDE_MODULES = /^(components\/ui|lib|hooks|core)$/;
const NOISE_SYMBOLS = new Set(['Loading', 'RootLayout', 'Layout', 'Metadata', 'metadata', 'ThemeProvider', 'Toaster', 'Provider']);
function isFeatureWorthy(n: ArtifactNode): boolean {
  if (n.kind !== 'symbol' || !n.symbol) return false;
  if (!['function', 'class', 'var'].includes(n.symbolKind ?? '')) return false; // 타입/인터페이스/enum 제외
  if (!/^[A-Z]/.test(n.symbol)) return false; // PascalCase = 컴포넌트/클래스
  if (EXCLUDE_MODULES.test(n.module)) return false;
  if (NOISE_SYMBOLS.has(n.symbol)) return false;
  return true;
}

function leadingComment(full: string, pos: number): string {
  const ranges = ts.getLeadingCommentRanges(full, pos) ?? [];
  return ranges
    .map((r) => full.slice(r.pos, r.end))
    .join(' ')
    .replace(/\/\*\*?|\*\/|^\s*\*|\/\//gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
function fileLeadingComment(text: string): string {
  return leadingComment(text, 0);
}
function firstLine(s: string): string {
  return s.split('\n')[0]!.replace(/\s+/g, ' ').trim().slice(0, 140);
}
function card(path: string, module: string, symbol: string | null, signature: string | null, doc: string): string {
  return [path, module, symbol, signature, doc].filter(Boolean).join(' · ');
}
function resolveImport(fromRel: string, spec: string): string {
  const base = toPosix(join(dirname(fromRel), spec));
  return base.replace(/\.js$/, '.ts');
}
function pushMember(map: Map<string, string[]>, k: string, v: string): void {
  const a = map.get(k) ?? [];
  a.push(v);
  map.set(k, a);
}
function toPosix(p: string): string {
  return p.split(sep).join('/');
}
function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}
