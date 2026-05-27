import ts from 'typescript';

// CommonJS extraction for the CodeFlow scanner (codeflow-layer.md §0 — the kiduki-gcs demo is heavily CJS).
// The TS Compiler API parses .js into an AST but recognizes only ES `import`/`export` as module syntax;
// CommonJS `require()` / `module.exports` are ordinary calls/assignments, so an ES-only pass yields bare
// file nodes with no edges/symbols. This module detects the CJS forms → import edges + exported-symbol
// nodes. Pure AST → facts; path resolution stays in scan.ts. Member-call edges (`ns.method()`) are
// collected scope-aware in scan.ts's collectFreeUses, not here.
//
// Handled: `const x = require('s')` / bare `require('s')`; `module.exports = fn|class|Identifier|{keys}`,
// `module.exports.NAME = …`, `exports.NAME = …`. Known-unsupported (degrade to MISSING edges, never
// false): `Object.assign(module.exports, {…})`, `exports = {…}` reassignment, `module.exports = require('…')`
// re-export passthrough, and `module.exports = localFn` (sets the default name but no symbol node is
// synthesized for a non-exported local — matches the ES default-export limitation in scan.ts).

export interface CjsRequire {
  local: string | null; // `const local = require(spec)`; null for a bare `require(spec)` side-effect import
  spec: string; // the require specifier as written (e.g. './routes/x')
}
export interface CjsExport {
  name: string;
  kind: string; // 'function' | 'class' | 'var'
  signature: string;
}
export interface CjsExtract {
  requires: CjsRequire[];
  exports: CjsExport[];
  // `module.exports = Foo | function Foo(){} | class Foo{}` → the module's main export name (acts like a default).
  defaultExportName: string | null;
}

const firstLine = (s: string): string => s.split('\n')[0]!.replace(/\s+/g, ' ').trim().slice(0, 140);

// Is `node` a `require('<string>')` call? Returns the specifier, else null.
function requireSpec(node: ts.Node): string | null {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]!)
  ) {
    return node.arguments[0]!.text;
  }
  return null;
}

function rhsKind(rhs: ts.Expression): string {
  if (ts.isFunctionExpression(rhs) || ts.isArrowFunction(rhs)) return 'function';
  if (ts.isClassExpression(rhs)) return 'class';
  return 'var';
}

// `module.exports` access?
function isModuleExports(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === 'module' &&
    e.name.text === 'exports'
  );
}

// Extract CommonJS requires + exports from a parsed source file (top-level statements, mirroring the
// ES pass's top-level granularity for determinism).
export function extractCommonJs(sf: ts.SourceFile): CjsExtract {
  const requires: CjsRequire[] = [];
  const exports: CjsExport[] = [];
  let defaultExportName: string | null = null;
  const seen = new Set<string>(); // dedupe export names within a file

  const addExport = (name: string, kind: string, sig: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    exports.push({ name, kind, signature: sig });
  };

  for (const stmt of sf.statements) {
    // `const a = require('x')` / `const { ... } = require('x')` (destructured → specifier only, no namespace).
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!d.initializer) continue;
        const spec = requireSpec(d.initializer);
        if (spec) requires.push({ local: ts.isIdentifier(d.name) ? d.name.text : null, spec });
      }
      continue;
    }
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;

    // bare `require('x')` (side-effect import)
    const bare = requireSpec(expr);
    if (bare) {
      requires.push({ local: null, spec: bare });
      continue;
    }

    // assignment forms: `module.exports = RHS`, `module.exports.NAME = RHS`, `exports.NAME = RHS`
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const lhs = expr.left;
    const rhs = expr.right;
    if (!ts.isPropertyAccessExpression(lhs)) continue;
    const sig = firstLine(sf.text.slice(stmt.getStart(sf), stmt.getEnd()));

    if (isModuleExports(lhs)) {
      // `module.exports = RHS`
      if ((ts.isFunctionExpression(rhs) || ts.isClassExpression(rhs)) && rhs.name) {
        defaultExportName = rhs.name.text;
        addExport(rhs.name.text, rhsKind(rhs), sig);
      } else if (ts.isIdentifier(rhs)) {
        defaultExportName = rhs.text;
      } else if (ts.isObjectLiteralExpression(rhs)) {
        // `module.exports = { foo, bar }` → each key is an exported symbol.
        for (const p of rhs.properties) {
          const n = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null;
          if (n) addExport(n, 'var', `module.exports.${n}`);
        }
      }
    } else if (isModuleExports(lhs.expression)) {
      // `module.exports.NAME = RHS`
      addExport(lhs.name.text, rhsKind(rhs), sig);
    } else if (ts.isIdentifier(lhs.expression) && lhs.expression.text === 'exports') {
      // `exports.NAME = RHS`
      addExport(lhs.name.text, rhsKind(rhs), sig);
    }
  }
  return { requires, exports, defaultExportName };
}
