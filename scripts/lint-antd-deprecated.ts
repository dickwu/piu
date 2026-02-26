#!/usr/bin/env bun
/**
 * Scans source files for deprecated antd v6 props.
 * Reads deprecations dynamically from node_modules/antd/es at runtime.
 *
 * Usage: bun run scripts/lint-antd-deprecated.ts
 */

import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const ANTD_ES = join(ROOT, 'node_modules', 'antd', 'es');
const SRC = join(ROOT, 'src');

// ─── Types ────────────────────────────────────────────────────────────────
interface DeprecationRule {
  deprecated: string;
  replacement: string;
  component: string;
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const warn  = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// ─── File walker ──────────────────────────────────────────────────────────
async function* walkFiles(dir: string, ext: RegExp): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full, ext);
    else if (ext.test(entry.name)) yield full;
  }
}

// ─── Phase 1: Extract deprecations from antd source ───────────────────────
async function extractDeprecations(): Promise<DeprecationRule[]> {
  const rules: DeprecationRule[] = [];
  const seen = new Set<string>();

  const addRule = (deprecated: string, replacement: string, component: string) => {
    const key = `${deprecated}:${replacement}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({ deprecated, replacement, component });
  };

  for await (const file of walkFiles(ANTD_ES, /\.js$/)) {
    const src = await readFile(file, 'utf8');
    if (!src.includes('.deprecated(') && !src.includes('deprecated(!(')) continue;

    // Resolve component name from devUseWarning('Name')
    const componentMatch = src.match(/devUseWarning\('([^']+)'\)/);
    const component = componentMatch?.[1] ?? relative(ANTD_ES, file).replace(/\/.*/, '');

    // Pattern 1: [['old','new'], ...].forEach(...)  =>  deprecated(...)
    const arrayRe = /\[\s*((?:\[.*?\]\s*,?\s*)+)\]\s*\.forEach\s*\(\s*\(\s*\[.*?\]\s*\)\s*=>\s*\{?\s*(?:warning\.)?deprecated\(/g;
    let arrayMatch: RegExpExecArray | null;
    while ((arrayMatch = arrayRe.exec(src)) !== null) {
      const pairsStr = arrayMatch[1];
      const pairRe = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
      let pairMatch: RegExpExecArray | null;
      while ((pairMatch = pairRe.exec(pairsStr)) !== null) {
        addRule(pairMatch[1], pairMatch[2], component);
      }
    }

    // Pattern 2: const deprecatedProps = { old: 'new', ... }; Object.entries(...).forEach(...)
    const objRe = /(?:const|let)\s+deprecatedProps\s*=\s*\{([^}]+)\}/g;
    let objMatch: RegExpExecArray | null;
    while ((objMatch = objRe.exec(src)) !== null) {
      const body = objMatch[1];
      const entryRe = /(\w+)\s*:\s*'([^']+)'/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRe.exec(body)) !== null) {
        addRule(entryMatch[1], entryMatch[2], component);
      }
    }

    // Pattern 3: standalone  warning.deprecated(!expr, 'old', 'new')  or  deprecated(!expr, 'old', 'new')
    const standaloneRe = /(?:warning\.)?deprecated\(\s*(?:![\w.?()[\]!]+|false)\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
    let standaloneMatch: RegExpExecArray | null;
    while ((standaloneMatch = standaloneRe.exec(src)) !== null) {
      addRule(standaloneMatch[1], standaloneMatch[2], component);
    }
  }

  return rules;
}

// ─── Phase 2: Scan project source files ───────────────────────────────────

// Props too generic to lint without AST-level component context.
// These are common prop names shared by many non-antd components (e.g. <Button type="primary">).
const AMBIGUOUS_PROPS = new Set([
  'type', 'width', 'height', 'direction', 'message', 'title', 'description',
  'children', 'mode', 'pending', 'pendingDot', 'operations', 'split',
  'routes', 'tip', 'visible', 'onVisibleChange', 'bordered', 'onSelect',
  'dataSource', // Table/List dataSource is valid; only AutoComplete is deprecated
]);

async function scanProject(rules: DeprecationRule[]): Promise<number> {
  // Group rules by deprecated prop name (some props appear in multiple components)
  const rulesByProp = new Map<string, DeprecationRule[]>();
  for (const rule of rules) {
    // Skip dotted paths (e.g. "items.label") and component-level deprecations (e.g. "BackTop")
    const propName = rule.deprecated.includes('.') ? null : rule.deprecated;
    if (!propName) continue;
    // Skip ambiguous prop names that need AST context
    if (AMBIGUOUS_PROPS.has(propName)) continue;
    const existing = rulesByProp.get(propName) ?? [];
    existing.push(rule);
    rulesByProp.set(propName, existing);
  }

  // Build regex patterns
  const patterns: Array<{ regex: RegExp; propName: string; rules: DeprecationRule[] }> = [];
  for (const [propName, propRules] of rulesByProp) {
    patterns.push({
      regex: new RegExp(`\\b${escapeRegex(propName)}\\s*=`, 'g'),
      propName,
      rules: propRules,
    });
  }

  const isDeclaration = (line: string) => /^\s*(const|let|var|type|interface|import|export)\s/.test(line);
  const isComment = (line: string) => /^\s*(\/\/|\/?\*|\*)/.test(line);

  let totalWarnings = 0;
  let filesWithWarnings = 0;

  for await (const file of walkFiles(SRC, /\.(tsx?|jsx?)$/)) {
    const src = await readFile(file, 'utf8');
    const lines = src.split('\n');
    const relPath = relative(SRC, file);
    const fileWarnings: string[] = [];

    for (const { regex, propName, rules: propRules } of patterns) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isDeclaration(line) || isComment(line)) continue;
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          const col = match.index + 1;
          const components = [...new Set(propRules.map((r) => r.component))].join('/');
          const replacement = propRules[0].replacement;
          fileWarnings.push(
            `  ${dim(`${i + 1}:${col}`)}  ${warn('warn')}  ${bold(propName)} → ${green(replacement)}${dim(` [${components}]`)}`
          );
          totalWarnings++;
        }
      }
    }

    if (fileWarnings.length > 0) {
      filesWithWarnings++;
      console.log(`\n${cyan(relPath)}`);
      fileWarnings.forEach((w) => console.log(w));
    }
  }

  console.log(
    totalWarnings === 0
      ? `\n${green('✓')} No deprecated antd props found.`
      : `\n${bold(`${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}`)} in ${filesWithWarnings} file${filesWithWarnings === 1 ? '' : 's'}`
  );

  return totalWarnings;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Main ─────────────────────────────────────────────────────────────────
console.log(dim('Extracting deprecations from node_modules/antd/es...'));
const rules = await extractDeprecations();
console.log(dim(`Found ${rules.length} deprecation rules. Scanning src/...\n`));

const warnings = await scanProject(rules);
process.exit(warnings > 0 ? 1 : 0);
