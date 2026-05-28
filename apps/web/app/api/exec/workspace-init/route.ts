// POST /api/exec/workspace-init
// Creates the workspace directory and seeds it with AGENTS.md + CLAUDE.md.
// When existingRepo is provided the repo is cloned and a feature branch is
// created + published before AGENTS.md / CLAUDE.md are written.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

interface InitBody {
  runId: string;
  title: string;
  spec: string;
  /** Git URL of an existing repo to clone instead of creating a blank workspace */
  existingRepo?: string;
  /** Feature branch name to create and push; required when existingRepo is set */
  featureBranch?: string;
}

const WORKSPACE_ROOT = '/home/coder/workspace';

/**
 * Returns stack-specific documentation-awareness rules for the seeded AGENTS.md.
 * The returned string uses literal \n (backslash-n) as line separators so it can
 * be embedded directly in the printf '%b' agentsContent string.
 */
function getStackDocRules(title: string, spec: string): string {
  const text = `${title} ${spec}`.toLowerCase();
  const NL = '\\n'; // two-char sequence interpreted by printf %b as newline
  const sections: string[] = [];

  if (/next\.?js|nextjs/.test(text)) {
    sections.push([
      '<!-- BEGIN:nextjs-agent-rules -->',
      '# This is NOT the Next.js you know',
      '',
      'This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.',
      '<!-- END:nextjs-agent-rules -->',
    ].join(NL));
  }

  if (/nuxt/.test(text)) {
    sections.push([
      '<!-- BEGIN:nuxt-agent-rules -->',
      '# Check installed Nuxt version first',
      '',
      'Run `cat node_modules/nuxt/package.json | grep version` to verify the installed version before writing code. Nuxt 3 has a fundamentally different API from Nuxt 2.',
      '<!-- END:nuxt-agent-rules -->',
    ].join(NL));
  }

  if (/\breact\b/.test(text) && !/next\.?js|nextjs/.test(text)) {
    sections.push([
      '<!-- BEGIN:react-agent-rules -->',
      '# Check installed React version first',
      '',
      'Run `cat node_modules/react/package.json | grep version` to verify the installed version. React 18 and 19 have meaningfully different APIs (concurrent features, hooks behaviour). Read `node_modules/react/README.md` if present.',
      '<!-- END:react-agent-rules -->',
    ].join(NL));
  }

  if (/\bvue\b/.test(text) && !/nuxt/.test(text)) {
    sections.push([
      '<!-- BEGIN:vue-agent-rules -->',
      '# Check installed Vue version first',
      '',
      'Run `cat node_modules/vue/package.json | grep version` to verify the installed version. Vue 3 (Composition API) is fundamentally different from Vue 2 (Options API).',
      '<!-- END:vue-agent-rules -->',
    ].join(NL));
  }

  if (/svelte|sveltekit/.test(text)) {
    sections.push([
      '<!-- BEGIN:svelte-agent-rules -->',
      '# Check installed Svelte version first',
      '',
      'Run `cat node_modules/svelte/package.json | grep version`. SvelteKit 2+ has different routing, load function, and adapter APIs from SvelteKit 1.',
      '<!-- END:svelte-agent-rules -->',
    ].join(NL));
  }

  if (/\bangular\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:angular-agent-rules -->',
      '# Check installed Angular version first',
      '',
      'Run `cat node_modules/@angular/core/package.json | grep version`. Angular 17+ (standalone components, signals) differs significantly from earlier versions.',
      '<!-- END:angular-agent-rules -->',
    ].join(NL));
  }

  if (/\bdjango\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:django-agent-rules -->',
      '# Check installed Django version first',
      '',
      'Run `pip show django` to verify the installed version before writing code. Django 4.x and 5.x differ from older versions in ORM, async support, and settings conventions.',
      '<!-- END:django-agent-rules -->',
    ].join(NL));
  }

  if (/\bfastapi\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:fastapi-agent-rules -->',
      '# Check installed FastAPI and Pydantic versions first',
      '',
      'Run `pip show fastapi pydantic` before writing code. Pydantic v2 has a completely different API from v1, and FastAPI 0.100+ requires Pydantic v2.',
      '<!-- END:fastapi-agent-rules -->',
    ].join(NL));
  }

  if (/\bflask\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:flask-agent-rules -->',
      '# Check installed Flask version first',
      '',
      'Run `pip show flask` before writing code. Flask 3.x changed several defaults and removed previously deprecated APIs compared to 2.x.',
      '<!-- END:flask-agent-rules -->',
    ].join(NL));
  }

  if (/rails|ruby on rails/.test(text)) {
    sections.push([
      '<!-- BEGIN:rails-agent-rules -->',
      '# Check installed Rails version first',
      '',
      'Run `bundle exec rails --version` before writing code. Rails 7+ (Hotwire, importmap) differs significantly from Rails 6 (Webpacker). Rails 8 ships Kamal by default.',
      '<!-- END:rails-agent-rules -->',
    ].join(NL));
  }

  if (/\blaravel\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:laravel-agent-rules -->',
      '# Check installed Laravel version first',
      '',
      'Run `php artisan --version` before writing code. Laravel 11 changed the default app structure; Laravel 10 differs from 9 in middleware and bootstrapping.',
      '<!-- END:laravel-agent-rules -->',
    ].join(NL));
  }

  if (/\bexpress\b/.test(text)) {
    sections.push([
      '<!-- BEGIN:express-agent-rules -->',
      '# Check installed Express version first',
      '',
      'Run `cat node_modules/express/package.json | grep version`. Express 5 (async error handling, path-to-regexp changes) differs significantly from Express 4.',
      '<!-- END:express-agent-rules -->',
    ].join(NL));
  }

  if (/nest\.?js|nestjs/.test(text)) {
    sections.push([
      '<!-- BEGIN:nestjs-agent-rules -->',
      '# Check installed NestJS version first',
      '',
      'Run `cat node_modules/@nestjs/core/package.json | grep version`. NestJS 10+ dropped support for several legacy patterns; always check the installed version.',
      '<!-- END:nestjs-agent-rules -->',
    ].join(NL));
  }

  if (sections.length === 0) {
    // Generic fallback for any stack
    sections.push([
      '<!-- BEGIN:doc-rules -->',
      '# Always check installed framework and library versions before writing code',
      '',
      'APIs change between major versions — never assume the API matches your training data.',
      '- Node/npm packages:  `cat node_modules/<pkg>/package.json | grep version`',
      '- Python packages:    `pip show <package>`',
      '- Ruby gems:          `bundle exec gem list <gem>`',
      '- PHP packages:       `composer show <vendor/package>`',
      '<!-- END:doc-rules -->',
    ].join(NL));
  }

  return sections.join(NL + NL);
}

function escapeShellHeredoc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/** Reject strings containing characters that break single-quoted shell arguments */
function isSafeForShellSingleQuote(s: string): boolean {
  return !s.includes("'");
}

function isValidGitUrl(url: string): boolean {
  if (!isSafeForShellSingleQuote(url)) return false;
  return (
    /^https:\/\/[a-zA-Z0-9._\-@:/]+(?:\.git)?$/.test(url) ||
    /^git@[a-zA-Z0-9._\-]+:[a-zA-Z0-9._\-/]+(?:\.git)?$/.test(url)
  );
}

function isValidBranchName(branch: string): boolean {
  if (!isSafeForShellSingleQuote(branch)) return false;
  // No shell specials, no consecutive dots, no leading slash
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,99}$/.test(branch) && !branch.includes('..');
}

export async function POST(req: NextRequest) {
  let body: InitBody;
  try {
    body = (await req.json()) as InitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, title, spec, existingRepo, featureBranch } = body;

  if (!runId || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (existingRepo !== undefined) {
    if (!isValidGitUrl(existingRepo)) {
      return NextResponse.json({ error: 'invalid existingRepo URL' }, { status: 400 });
    }
    if (!featureBranch || !isValidBranchName(featureBranch)) {
      return NextResponse.json({ error: 'invalid or missing featureBranch' }, { status: 400 });
    }
  }

  const workspaceDir = `${WORKSPACE_ROOT}/${runId}`;
  const safeTitle   = escapeShellHeredoc(title.slice(0, 200));
  const safeSpec    = escapeShellHeredoc((spec ?? '').slice(0, 4000));
  const date        = new Date().toISOString().split('T')[0];

  const agentsContent =
    `# Project: ${safeTitle}\\n\\n` +
    `Generated by Open Pilot on ${date}.\\n\\n` +
    `## Purpose\\n\\n${safeSpec}\\n\\n` +
    `<!-- BEGIN:RULES -->\\n` +
    `The user is not a developer, you will not ask the user for feedback you will do the entire job. ` +
    `You will not try to run tool calls with elevated privileges, you will not ask the user to run tools you will run them yourself.\\n` +
    `<!-- END:RULES -->\\n\\n` +
    `${getStackDocRules(title, spec ?? '')}\\n\\n` +
    `## Agent Working Rules\\n\\n` +
    `- Write complete, production-ready code — no placeholders or TODOs.\\n` +
    `- Run \`npm install\` / \`pip install\` before building when adding new dependencies.\\n` +
    `- Run the build/test suite and fix all errors before marking a task done.\\n` +
    `- Prefer editing existing files over creating new ones.\\n` +
    `- Never run \`git push\`, \`git remote add\`, or \`gh\` commands — no remote is configured in this workspace. GitHub deployment is handled automatically when the run completes.\\n` +
    `- Keep this file (AGENTS.md) updated as architecture, build commands, or conventions evolve.\\n\\n` +
    `## Architecture\\n\\n<!-- The agent will fill this in as the project is built. -->\\n\\n` +
    `## Build & Run\\n\\n<!-- The agent will fill this in. -->\\n\\n` +
    `## Testing\\n\\n<!-- The agent will fill this in. -->\\n`;
  const claudeContent = `@AGENTS.md\\n`;

  let cmd: string;

  if (existingRepo && featureBranch) {
    // Clone the existing repo, create + publish the feature branch, then seed context files
    cmd = [
      `git clone '${existingRepo}' '${workspaceDir}'`,
      `git -C '${workspaceDir}' checkout -b '${featureBranch}'`,
      // Attempt to publish; capture result without failing the whole command
      `(git -C '${workspaceDir}' push -u origin '${featureBranch}' 2>&1 && echo '___PUSH_OK___' || echo '___PUSH_FAIL___')`,
      `printf '%b' '${agentsContent}' > '${workspaceDir}/AGENTS.md'`,
      `printf '%b' '${claudeContent}' > '${workspaceDir}/CLAUDE.md'`,
    ].join(' && ');
  } else {
    cmd = [
      `mkdir -p '${workspaceDir}'`,
      `printf '%b' '${agentsContent}' > '${workspaceDir}/AGENTS.md'`,
      `printf '%b' '${claudeContent}' > '${workspaceDir}/CLAUDE.md'`,
    ].join(' && ');
  }

  try {
    const result = await runInContainer(cmd, '/home/coder', existingRepo ? 120_000 : 15_000);
    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `workspace init failed: ${result.output.slice(0, 300)}` },
        { status: 500 },
      );
    }
    const branchPushed = existingRepo ? result.output.includes('___PUSH_OK___') : undefined;
    return NextResponse.json({ ok: true, ...(existingRepo ? { branchPushed } : {}) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
