import ts from 'typescript';

// Language registry (codeflow-layer.md §4). Centralizes WHICH file extensions CodeFlow parses and HOW,
// so supporting a new language is a registry edit rather than conditionals scattered across scan.ts.
//
// The JS/TS family (.ts/.tsx/.js/.jsx/.mjs/.cjs) all parse through the same TypeScript Compiler API —
// TS is a superset of JS, so one parser covers the whole family, differing only by ScriptKind. Vue SFCs
// (.vue) are handled by pulling their <script> block out (prepareSource) and parsing that as JS/TS. Both
// ES modules and CommonJS are extracted (see scan.ts + commonjs.ts). A genuinely different language (e.g.
// Python) needs a different parser; per the agreed design we defer extracting a neutral LanguageParser
// interface until that second parser actually lands (we'll know the real seam then). Until then this
// registry is the single place the supported file types are declared.

// Source extensions CodeFlow scans. JS/TS family parse directly; .vue parses via its extracted <script>.
export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'] as const;

// ScriptKind per extension so JSX/TSX get JSX parsing and plain JS is parsed as loose JS (not strict TS).
// (.vue is resolved by prepareSource before this is consulted.)
export function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS; // .js / .mjs / .cjs
}

// What scan.ts feeds to the parser for one file. For the JS/TS family this is the file verbatim; for a
// Vue SFC, `code` is the extracted <script> block while `uiText` stays the whole SFC (so the <template>
// still feeds UI-surface extraction).
export interface PreparedSource {
  code: string;
  scriptKind: ts.ScriptKind;
  uiText: string;
}

// Pull the parseable code out of a source file. Vue SFCs: extract the <script> block (honoring lang=ts/tsx/jsx,
// default JS); kiduki-gcs SFCs are plain <script> Options API. Everything else: identity.
export function prepareSource(path: string, text: string): PreparedSource {
  if (path.endsWith('.vue')) {
    // Concatenate ALL <script> blocks so a Vue 3 dual-block SFC (`<script setup>` + `<script>` Options) is
    // fully covered — the Options block carries `export default { name }` + imports, the setup block its own
    // imports. Parsing them together is fine for symbol/edge extraction even if not runnable as one module.
    const blocks = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const code = blocks.map((b) => b[2]).join('\n');
    const attrs = blocks.map((b) => b[1]).join(' ');
    const lang = /lang\s*=\s*["']?(tsx?|jsx?)/i.exec(attrs)?.[1]?.toLowerCase();
    const scriptKind =
      lang === 'ts' ? ts.ScriptKind.TS
      : lang === 'tsx' ? ts.ScriptKind.TSX
      : lang === 'jsx' ? ts.ScriptKind.JSX
      : ts.ScriptKind.JS;
    return { code, scriptKind, uiText: text };
  }
  return { code: text, scriptKind: scriptKindFor(path), uiText: text };
}

// Is this a code file CodeFlow should parse? (Declaration files are excluded separately.)
export function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((e) => name.endsWith(e));
}

// Declaration files (.d.ts / .d.mts / .d.cts) carry no runtime symbols — skip them.
export function isDeclarationFile(name: string): boolean {
  return /\.d\.[cm]?ts$/.test(name);
}

// Test/spec files — excluded from the artifact graph (they are not product surface).
export function isTestSourceFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

// Module-resolution helper for ext-less import targets (e.g. './m' → './m.ts' | './m.js' | './m/index.js').
// Returns the candidate file paths to try, in priority order, given a (possibly ext-less) target.
export function resolveCandidates(toRel: string): string[] {
  const base = toRel.replace(/\.(tsx?|jsx?|[cm]js)$/, '');
  const withExt = CODE_EXTENSIONS.map((e) => base + e);
  const asIndex = CODE_EXTENSIONS.map((e) => `${base}/index${e}`);
  return [toRel, ...withExt, ...asIndex];
}

// Strip a source extension from an import specifier (so './m.js' and './m' resolve to the same base).
export function stripSourceExt(spec: string): string {
  return spec.replace(/\.(tsx?|jsx?|[cm]js)$/, '');
}
