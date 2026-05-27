// utils/fileParser.ts
// Shared utilities for extracting code files from LLM output text.
// Used by FilesModal (display) and AgentWorkspace (exec file sync).

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedFile {
  path:     string;
  language: string;
  content:  string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const CODE_EXTS = new Set([
  'ts','tsx','js','jsx','mjs','cjs',
  'css','scss','sass','less',
  'html','htm','xml','svg',
  'json','jsonc',
  'py','rb','go','rs','java','kt','swift','c','h','cpp','hpp','cs','php',
  'sh','bash','zsh',
  'yml','yaml','toml','ini','env',
  'md','mdx','prisma','graphql','gql','sql',
  'gitignore','dockerignore','prettierrc','eslintrc','babelrc','editorconfig',
]);

export function looksLikePath(s: string): boolean {
  const clean = s.trim();
  if (!clean || clean.length > 200 || clean.includes('\n')) return false;
  const last = clean.split('/').pop() ?? clean;
  const ext  = last.split('.').pop()?.toLowerCase() ?? '';
  return CODE_EXTS.has(ext) || (clean.includes('/') && clean.includes('.'));
}

export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function guessLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    css: 'css', scss: 'scss', html: 'html', json: 'json',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', md: 'markdown',
    prisma: 'prisma', graphql: 'graphql', sql: 'sql',
  };
  return map[ext] ?? ext;
}

/**
 * Extract files from one text blob using three strategies.
 * Last version of a path wins (corrections overwrite earlier drafts).
 */
export function extractFilesFromText(
  text: string,
  into: Map<string, ParsedFile>,
): void {
  let m: RegExpExecArray | null;

  // Strategy 1: path in fence header  →  ```lang path/to/file.ext
  const s1 = /```([a-zA-Z0-9_+\-]*)[ \t]+([^\n`\s]+)[^\n]*\n([\s\S]*?)```/g;
  while ((m = s1.exec(text)) !== null) {
    const [, lang, rawPath, content] = m;
    const path = normalizePath(rawPath);
    if (looksLikePath(path))
      into.set(path, { path, language: lang || guessLang(path), content: content.trim() });
  }

  // Strategy 2: path as first comment line  →  ```lang\n// src/App.tsx
  const s2 = /```([a-zA-Z0-9_+\-]*)\n(?:\/\/\s*|#\s*|--\s*)([^\n*/\s][^\n]*)\n([\s\S]*?)```/g;
  while ((m = s2.exec(text)) !== null) {
    const [, lang, rawComment, content] = m;
    const candidate = rawComment.trim().split(/\s+/)[0];
    const path = normalizePath(candidate);
    if (looksLikePath(path) && !into.has(path))
      into.set(path, { path, language: lang || guessLang(path), content: content.trim() });
  }

  // Strategy 3: path annotated before the block
  // Handles: **path.tsx**  `path.tsx`  ### path.tsx  "File: path.tsx"  path.tsx:
  const s3 = /(?:\*{1,2}|`|#{1,4}\s*|[Ff]ile:\s*)?([^\n`*#\s][^\n`*]{0,150}\.[a-zA-Z]{1,12})[`*]{0,2}\s*:?\s*\n(?:\n)*```([a-zA-Z0-9_+\-]*)\n([\s\S]*?)```/gm;
  while ((m = s3.exec(text)) !== null) {
    const [, rawPath, lang, content] = m;
    const path = normalizePath(rawPath.trim().replace(/[`*_]/g, ''));
    if (looksLikePath(path) && !into.has(path))
      into.set(path, { path, language: lang || guessLang(path), content: content.trim() });
  }
}
