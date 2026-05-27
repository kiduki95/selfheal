import ts from 'typescript';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, sep } from 'node:path';
import { isCodeFile, isDeclarationFile, isTestSourceFile, scriptKindFor, resolveCandidates, stripSourceExt } from './languages.js';

// codeflow T1 parse (codeflow-layer.md §4) — TypeScript Compiler API로 결정론 추출 (Claude 0).
// tree-sitter 대신 이미 있는 `typescript` 의존성 사용 → 네이티브 빌드 없이 크로스플랫폼.
// JS/TS family (.ts/.tsx/.js/.jsx/.mjs/.cjs) 다중 소스루트 지원 — 언어 선언은 languages.ts 레지스트리
// 단일 출처. 산출: module/file/symbol 노드 + contains/imports/calls 엣지 + 모듈→기능(feature) 후보.

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
  kind: 'contains' | 'imports' | 'calls' | 'provides';
}
export interface FeatureSpec {
  slug: string;
  pref_label: string;
  description: string;
  memberKeys: string[];
  parentSlug?: string; // 컴포넌트 feature는 모듈 feature를 parent로 (SKOS broader)
  level: 'module' | 'component';
  uiSurface?: string; // 컴포넌트 내부 UI 요소(헤딩/Label/htmlFor/탭값) — sub-feature 열거 재료
  fileKey?: string; // 컴포넌트가 사는 파일 노드 key (sub-feature 앵커)
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

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', 'public', 'styles', '.github', 'vendor', 'build', 'out', 'target', '.venv', '.turbo']);
const MAX_FILE_BYTES = 1_000_000; // skip generated/huge files (codegraph convention)
const SRC_CANDIDATES = ['src', 'app', 'components', 'lib', 'hooks', 'pages', 'server', 'client'];

export function scanRepo(opts: ScanOptions): ScanResult {
  const root = opts.rootDir;
  const srcDirs = opts.srcDirs ?? SRC_CANDIDATES.filter((d) => existsSync(join(root, d)));

  const files = srcDirs
    .flatMap((d) => walkCode(join(root, d)))
    .filter((f) => !isDeclarationFile(f) && !isTestSourceFile(f));

  const nodes: ArtifactNode[] = [];
  const edges: EdgeSpec[] = [];
  const fileKeyByPath = new Map<string, string>();
  const fileModule = new Map<string, string>(); // fileKey → module
  const uiSurfaceByFile = new Map<string, string>(); // fileKey → UI surface
  const moduleMembers = new Map<string, string[]>();
  const importPairs: { fromFile: string; toRel: string }[] = [];
  const moduleSet = new Set<string>();
  // For calls edges: per file, which local name binds to which imported symbol+target, and which names are actually used.
  const callBindings = new Map<string, Map<string, { importedName: string; toRel: string }>>();
  const defaultBindings = new Map<string, Map<string, string>>(); // file → (localName → toRel) for `import X from './m'`
  const defaultNameByFile = new Map<string, string>(); // fileKey → its default export's symbol name (resolves default imports)
  // Free uses = identifiers called/rendered that are NOT bound in their own scope chain, so they
  // refer to an outer/import binding. Scope-aware (vs a flat name set) so a local that shadows an
  // import suppresses only the calls in its own scope, not a same-named import use in a sibling scope.
  const usedNames = new Map<string, Set<string>>();

  for (const abs of files) {
    const relPath = toPosix(relative(root, abs));
    const module = moduleOf(toPosix(relative(root, dirname(abs))));
    moduleSet.add(module);
    const text = readFileSync(abs, 'utf8');
    const fileKey = relPath;
    fileKeyByPath.set(relPath, fileKey);
    fileModule.set(fileKey, module);
    uiSurfaceByFile.set(fileKey, extractUiSurface(text));

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

    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        if (spec.startsWith('.') || spec.startsWith('@/')) {
          const toRel = resolveImport(relPath, spec);
          importPairs.push({ fromFile: relPath, toRel });
          const clause = stmt.importClause;
          // Capture named-import bindings: localName → { importedName (handles `as`), target }.
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            const binds = callBindings.get(relPath) ?? new Map();
            for (const el of clause.namedBindings.elements) binds.set(el.name.text, { importedName: (el.propertyName ?? el.name).text, toRel });
            callBindings.set(relPath, binds);
          }
          // Capture default-import binding: `import X from './m'` → X resolves to m's default export symbol.
          if (clause?.name) {
            const dbinds = defaultBindings.get(relPath) ?? new Map<string, string>();
            dbinds.set(clause.name.text, toRel);
            defaultBindings.set(relPath, dbinds);
          }
        }
        continue;
      }
      // Record this file's default export name so default imports elsewhere resolve to a real symbol node.
      // Limitation: `export default Foo` where Foo is a non-exported local creates no symbol node, so the
      // default-import edge won't resolve (guarded by nodeKeySet below — degrades to a missing edge, never
      // a dangling one). The common `export default function/class Foo` form (below) does resolve.
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
        defaultNameByFile.set(relPath, stmt.expression.text);
      }
      if (!isExported(stmt)) continue;
      if (hasDefaultModifier(stmt) && (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
        defaultNameByFile.set(relPath, stmt.name.text);
      }
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
    usedNames.set(relPath, collectFreeUses(sf)); // free call/JSX/new usages → calls edges below
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

  // imports 엣지 (해소되는 것만) — 확장자 없는 별칭/상대경로 모두 .ts/.tsx/index로 시도
  for (const { fromFile, toRel } of importPairs) {
    const dst = resolveToFileKey(toRel, fileKeyByPath);
    if (dst && dst !== fromFile) edges.push({ srcKey: fromFile, dstKey: dst, kind: 'imports' });
  }

  // calls 엣지 — TypeChecker 없이 import binding으로 해소 (codegraph의 calls/impact를 우리식으로).
  // src=호출하는 파일, dst=실제 호출/렌더된 내부 export 심볼. 외부(lib) 호출은 노드가 없어 자연 제외.
  // impact(blast-radius) = 한 심볼을 호출하는 distinct 파일 수 → Insight 우선순위·Auto-Dev 입력.
  const nodeKeySet = new Set(nodes.map((n) => n.key));
  const callSeen = new Set<string>();
  for (const [fromFile, used] of usedNames) {
    const binds = callBindings.get(fromFile);
    const dbinds = defaultBindings.get(fromFile);
    if (!binds && !dbinds) continue;
    for (const name of used) {
      // `name` is a free use (not shadowed by a local in its scope), so it may bind to an import.
      let dstKey: string | undefined;
      const b = binds?.get(name);
      if (b) {
        const dstFile = resolveToFileKey(b.toRel, fileKeyByPath);
        if (dstFile && dstFile !== fromFile) dstKey = `${dstFile}#${b.importedName}`;
      } else if (dbinds?.has(name)) {
        const dstFile = resolveToFileKey(dbinds.get(name)!, fileKeyByPath);
        const defName = dstFile ? defaultNameByFile.get(dstFile) : undefined;
        if (dstFile && dstFile !== fromFile && defName) dstKey = `${dstFile}#${defName}`;
      }
      if (!dstKey || !nodeKeySet.has(dstKey)) continue; // only intra-repo exported symbols we tracked
      const sig = `${fromFile}->${dstKey}`;
      if (callSeen.has(sig)) continue;
      callSeen.add(sig);
      edges.push({ srcKey: fromFile, dstKey, kind: 'calls' });
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
      uiSurface: uiSurfaceByFile.get(n.path),
      fileKey: n.path,
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
    else if (isCodeFile(e.name) && !isDeclarationFile(e.name)) {
      try { if (statSync(p).size <= MAX_FILE_BYTES) out.push(p); } catch { /* unreadable → skip */ }
    }
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
function hasDefaultModifier(node: ts.Node): boolean {
  const mods = (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined) ?? [];
  return mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}
function isFunctionScope(n: ts.Node): boolean {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}
// Names declared directly within one function scope (its params + own var/func/class/destructured
// bindings), NOT descending into nested function scopes. Function-scope granularity is enough to
// catch the cases that shadow imports (params, function-local consts); block scoping is ignored.
function declaredInScope(scopeNode: ts.Node): Set<string> {
  const names = new Set<string>();
  const collect = (node: ts.Node, isRoot: boolean) => {
    if (!isRoot && isFunctionScope(node)) return; // stop at nested function boundary
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    else if (ts.isClassDeclaration(node) && node.name) names.add(node.name.text);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    else if (ts.isParameter(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, (c) => collect(c, false));
  };
  collect(scopeNode, true);
  return names;
}
// Scope-aware free-use collection: an identifier called / instantiated / rendered (JSX) is "free"
// when it is NOT bound anywhere in its enclosing scope chain, so it must refer to an import (or an
// outer binding). This is what lets a local that shadows an import suppress only its own scope's
// calls while a same-named import use in a sibling scope still yields a calls edge.
function collectFreeUses(sf: ts.SourceFile): Set<string> {
  const free = new Set<string>();
  const rootId = (e: ts.Expression): string | null =>
    ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? rootId(e.expression) : null;
  const boundInChain = (chain: Set<string>[], name: string): boolean => chain.some((s) => s.has(name));

  const walkScope = (scopeNode: ts.Node, parentChain: Set<string>[]) => {
    const chain = [...parentChain, declaredInScope(scopeNode)];
    const visit = (node: ts.Node, isScopeRoot: boolean) => {
      if (!isScopeRoot && isFunctionScope(node)) { walkScope(node, chain); return; } // descend via own scope
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const id = rootId(node.expression);
        if (id && !boundInChain(chain, id)) free.add(id);
      } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const id = ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? rootId(tag) : null;
        if (id && !boundInChain(chain, id)) free.add(id);
      }
      ts.forEachChild(node, (c) => visit(c, false));
    };
    visit(scopeNode, true);
  };
  walkScope(sf, []);
  return free;
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

// "사용자 대면 기능다운" 심볼 판정 — leaf feature 승격 대상 (codeflow ① finer features).
// PascalCase 컴포넌트/클래스/페이지만; ui 프리미티브·타입·유틸·Next 노이즈 제외.
const EXCLUDE_MODULES = /^(components\/ui|lib|hooks|core)$/;
const NOISE_SYMBOLS = new Set(['Loading', 'RootLayout', 'Layout', 'Metadata', 'metadata', 'ThemeProvider', 'Toaster', 'Provider']);
// 컴포넌트 파일에서 사용자 대면 UI 요소 추출 (헤딩/Label 텍스트/htmlFor id/탭값) — sub-feature 열거 재료.
export function extractUiSurface(text: string): string {
  const items = new Set<string>();
  const add = (re: RegExp) => { for (const m of text.matchAll(re)) { const v = (m[1] ?? '').trim(); if (v.length >= 2 && v.length <= 40 && !/[{}<>]/.test(v)) items.add(v); } };
  add(/<h[1-4][^>]*>\s*([^<>{}\n]{2,40})/g); // 섹션 헤딩
  add(/<Label[^>]*>\s*([^<>{}\n]{2,40})/g); // 라벨 텍스트
  add(/htmlFor="([a-zA-Z0-9_-]{3,40})"/g); // 폼 컨트롤 id (rsi-condition, golden-cross-condition …)
  add(/TabsTrigger[^>]*value="([a-zA-Z0-9_-]{2,30})"/g); // 탭
  return [...items].slice(0, 40).join(' | ').slice(0, 800);
}

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
  if (spec.startsWith('@/')) return stripSourceExt(spec.slice(2)); // tsconfig paths: @/* → 루트상대
  return stripSourceExt(toPosix(join(dirname(fromRel), spec)));
}
// Resolve a bare import target to an actual file node key (try ext-less alias/relative across the
// JS/TS family + index files — see languages.ts resolveCandidates).
function resolveToFileKey(toRel: string, fileKeyByPath: Map<string, string>): string | undefined {
  for (const cand of resolveCandidates(toRel)) {
    const dst = fileKeyByPath.get(cand);
    if (dst) return dst;
  }
  return undefined;
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
