// services/agentOrchestrator.ts
// Types, system prompts, token parsing, and state transitions for the
// Worker ↔ Manager agent orchestration loop.

import personalitiesData from '../data/personalities.json';

export type PersonalityId = 'developer' | 'designer' | 'writer' | 'gamedev' | 'secops' | 'devops' | 'qa' | 'datascientist';

export interface PersonalityDef {
  id: PersonalityId;
  label: string;
  icon: string;
  description: string;
  titlePlaceholder: string;
  specPlaceholder: string;
  workerSystem: string;
  managerSystem: string;
}

/** All available agent personalities loaded from data/personalities.json */
export const personalities = personalitiesData as Record<PersonalityId, PersonalityDef>;

// Planning phase instructions injected into every personality's manager system prompt.
// Kept short so it does not conflict with the personality's own token rules.
const PLANNING_PHASE_SUFFIX = `

PLANNING RULE — first response only:
Before assigning any task, produce a numbered plan then immediately assign task 1 IN THE SAME RESPONSE:

[PLAN:
1. <one-line title>
2. <one-line title>
...
]
[NEXT_TASK: 1. <title> — <what to build + key acceptance criteria; 100–150 words max>]

Both tokens MUST appear together in your first response. Never emit [PLAN:] without [NEXT_TASK:] in the same message.

EXECUTION RULE — all subsequent responses:
- Prefix each [NEXT_TASK:] with its plan number: [NEXT_TASK: 3. Add login page — ...]
- Keep [NEXT_TASK:] concise: state what to build and acceptance criteria — NOT a step-by-step tutorial. 150 words max.`;

/** Return the worker/manager system prompts for the given category. Defaults to 'developer'. */
export function getSystemPrompts(category?: string): { worker: string; manager: string } {
  const id = (category && category in personalities ? category : 'developer') as PersonalityId;
  const p = personalities[id];
  return { worker: p.workerSystem, manager: p.managerSystem + PLANNING_PHASE_SUFFIX };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type RunStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

export type NextStep =
  | 'manager-init'    // manager reads spec and assigns first task
  | 'worker-execute'  // worker receives task and builds
  | 'manager-review'  // manager reviews worker output
  | 'manager-answer'  // manager answers worker question
  | null;

export type LogEntryType =
  | 'task'         // manager assigns a task to worker
  | 'output'       // worker produces code/output
  | 'question'     // worker asks manager a question
  | 'answer'       // manager answers worker question
  | 'review'       // manager's full review response
  | 'correction'   // manager requests corrections
  | 'directive'    // manager's full response (task assignment etc.)
  | 'status'       // system/status message
  | 'user-input'   // user injection
  | 'exec'         // shell command requested by worker
  | 'exec-result'  // output from a shell command
  | 'checkpoint';  // auto-saved workspace checkpoint

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  from: 'worker' | 'manager' | 'user' | 'system';
  type: LogEntryType;
  content: string;
  /** Which panel(s) this entry appears in */
  target: 'worker' | 'manager' | 'both';
  /** True when this entry was produced while a monitor advisory was in context */
  monitorAdvised?: boolean;
}

export interface AgentRunConfig {
  workerModel: string;
  workerReasoningEffort: string;
  managerModel: string;
  managerReasoningEffort: string;
  maxIterations: number;
  approvalMode: 'approvals' | 'bypass' | 'autopilot';
  /** When true, automatically create a GitHub repo and push on completion */
  pushToGithub?: boolean;
  /** Desired repo name slug (empty string = derive from run title) */
  githubRepo?: string;
  /** Agent personality category */
  category?: PersonalityId;
  /** Git URL of an existing repo to clone as the workspace instead of starting fresh */
  existingRepo?: string;
  /** Feature branch to create and publish when continuing from an existing repo */
  featureBranch?: string;
}

// ─── Plan / Todo ─────────────────────────────────────────────────────────────

export type PlanTaskStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export interface PlanTask {
  /** 1-based task number as written in [PLAN: ...] */
  id: number;
  title: string;
  status: PlanTaskStatus;
}

/** Parse a [PLAN: ...] body into a list of PlanTasks. */
export function parsePlanContent(raw: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (m) tasks.push({ id: parseInt(m[1], 10), title: m[2].trim(), status: 'pending' });
  }
  return tasks;
}

/** A snapshot of the workspace at a point in time, backed by a git commit. */
export interface Checkpoint {
  id: string;
  /** Human-friendly name, e.g. "Checkpoint 1" */
  name: string;
  /** Raw command label, e.g. "exec: npm install" */
  label: string;
  /** Git SHA of the commit in the workspace repo */
  commitHash: string;
  createdAt: number;
  /** Which agent iteration this was taken at */
  iteration: number;
  /** ID of the corresponding log entry so the panel can scroll the chat to it */
  logEntryId: string;
}

export interface AgentRun {
  id: string;
  title: string;
  spec: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  config: AgentRunConfig;
  currentIteration: number;
  /** Worker conversation turns (no system message — prepended at call time) */
  workerHistory: AgentMessage[];
  /** Manager conversation turns (no system message — prepended at call time) */
  managerHistory: AgentMessage[];
  /** Shared log rendered in the two panels */
  log: LogEntry[];
  nextStep: NextStep;
  pendingQuestion?: string;
  /** Serve command declared by the worker via [SERVE: ...] */
  previewCommand?: string;
  /** True once any [EXEC: ...] has exited with code 0 — unlocks the preview button */
  previewUnlocked?: boolean;
  /** Port allocated for this run's preview server (assigned from the pool on first start) */
  previewPort?: number;
  /** Git-backed workspace snapshots, auto-created after each successful exec */
  checkpoints?: Checkpoint[];
  /** Structured task plan produced by the manager at the start of the run */
  plan?: PlanTask[];
}

// ─── System Prompts ──────────────────────────────────────────────────────────

export const WORKER_SYSTEM = `You are a skilled software engineer working autonomously on an app development project. A manager agent assigns you tasks from a specification document.

For each task:
1. Implement it fully with complete, working code.
2. Show each file in a fenced code block with the file path on the SAME LINE as the opening backticks, e.g.:
   \`\`\`typescript src/components/Navbar.tsx
   // code here
   \`\`\`
   IMPORTANT: the path must be on the opening line, NOT on a separate line below it.
   Correct:   \`\`\`json package.json
   Wrong:     \`\`\`json\\n package.json
3. Never use placeholders, TODOs, or "// implement this later" — write real, runnable code.
4. If you have a clarifying question, include it as: [QUESTION: your question here]
5. You have a terminal in your workspace. Use [EXEC: command] to run shell commands:
   - Install dependencies:  [EXEC: npm install]
   - Build:                 [EXEC: npm run build]
   - Run tests:             [EXEC: npm test]
   - Any shell command:     [EXEC: node -e "console.log('hi')"]
   If you are creating a NEW package.json (not updating an existing one), run
   [EXEC: rm -rf node_modules package-lock.json && npm install] to avoid stale lockfile conflicts.
   All code files you output are automatically synced to your workspace before each command runs.
   After receiving the command output, fix any errors and run again until it passes.
   PACKAGE VERSIONS — CRITICAL RULE:
   NEVER write a package.json with exact X.Y.Z version numbers you have not verified first.
   Your training data is outdated; version numbers you "know" are often wrong or nonexistent.
   ALWAYS use caret ranges (^major or ^major.minor) in package.json — e.g. "next": "^14",
   "react": "^18", "zod": "^3", "tailwindcss": "^3". Do NOT write bare "14.3.0" style strings.
   If you must pin a specific version, run this BEFORE writing package.json:
   [EXEC: npm show <pkg> version 2>&1] to find the latest, then use ^<that version>.
6. Once the project can be served or previewed, declare the serve command on port 4000 with:
   [SERVE: <command>]  e.g.  [SERVE: npx serve -p 4000 dist]
   Always use port 4000. Use whatever server fits the project type.
   This unlocks a live preview button for the user — include it as soon as the first successful build.
7. End your response with [DONE] when you have completed the task (and any build/tests pass).
8. If you are completely blocked and cannot continue, end with [BLOCKED: reason].
   IMPORTANT: Do NOT use [BLOCKED] for git remote/push errors. This workspace has no remote
   origin configured — git push is handled automatically by the system after the run completes.
   Local git commands (init, add, commit, log, status, diff) work fine.
9. Do NOT run \`git push\`, \`git remote add origin\`, or GitHub CLI (\`gh\`) commands. This
   environment has no remote credentials. GitHub deployment is handled automatically after
   completion. Only run local git commands (\`git init\`, \`git add\`, \`git commit\`, etc.).
   This also applies to commands embedded in shell scripts or bash -lc wrappers — for example,
   do NOT run [EXEC: bash -lc "... && git push ..."] either.
10. The workspace contains AGENTS.md and CLAUDE.md. After completing each significant feature, update the **Architecture**, **Build & Run**, and **Testing** sections of AGENTS.md to reflect the current state of the project.

Write production-quality code. Never truncate or omit code.`;

export const MANAGER_SYSTEM = `You are a technical project manager and senior code reviewer working with an autonomous software engineer (the worker agent).

Your responsibilities:
1. On first message: Read the specification carefully.
   - Emit a numbered plan (one-line titles) and assign task 1 in the SAME response:
     [PLAN:\n     1. title\n     2. title\n     ...]
     [NEXT_TASK: 1. title — what to build + acceptance criteria, 100–150 words max]
   - Both tokens MUST appear together. Never emit [PLAN:] without [NEXT_TASK:] in the same message.
2. After each worker response: Review the output against the specification.
3. If the code meets the spec: Acknowledge briefly and assign the next task with [NEXT_TASK: N. title — brief description]
4. If there are issues: Request specific changes with [CORRECTION: exactly what to change and why]
5. Answer worker questions clearly with: [ANSWER: your answer]
6. When ALL features in the specification have been implemented and reviewed: end with [COMPLETE]

Rules:
- Assign exactly ONE task at a time
- Prefix each [NEXT_TASK:] with its plan number (e.g. [NEXT_TASK: 3. Build login form — ...])
- Keep [NEXT_TASK:] concise: state what to build and acceptance criteria. Do NOT write tutorials. 150 words max.
- In [CORRECTION], name the exact file, function, or line that needs changing. Keep [CORRECTION:] under 80 words — do not repeat working code or the full spec.
- Do not emit [COMPLETE] until every feature in the spec is implemented and reviewed
- CRITICAL: Every response MUST end with exactly one of: [NEXT_TASK:...], [CORRECTION:...], [ANSWER:...], or [COMPLETE]. Never write a response without one of these.
- Keep your analysis brief — emit the token as early as possible
- Do NOT specify exact X.Y.Z version numbers for npm packages. Describe what to install by name only (e.g. "install react-query"); let the worker pick compatible versions.
- The workspace contains AGENTS.md. Verify the worker kept it updated; if not, include updating it in the next task or correction.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function makeLogId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function logEntry(
  from: LogEntry['from'],
  type: LogEntryType,
  content: string,
  target: LogEntry['target'] = 'both',
): LogEntry {
  return { id: makeLogId(), timestamp: Date.now(), from, type, content, target };
}

// ─── Token Parser ─────────────────────────────────────────────────────────────

interface Tokens {
  question?:     string;
  answer?:       string;
  nextTask?:     string;
  correction?:   string;
  blocked?:      string;
  serveCommand?: string;
  execCommands:  string[];
  done:          boolean;
  complete:      boolean;
  /** Raw content of [PLAN: ...] — task list emitted by manager on first response */
  plan?:         string;
  /** Task number from [TASK_DONE: N] — manager marks a plan item complete */
  taskDone?:     number;
}

/**
 * Extract the content of a bracket-delimited token, e.g. [NEXT_TASK: ...].
 * Counts bracket depth so nested [...] inside the content (e.g. YAML arrays)
 * don't prematurely terminate the match.
 */
function grabToken(text: string, name: string): string | undefined {
  const startMark = `[${name}:`;
  const idx = text.indexOf(startMark);
  if (idx === -1) return undefined;

  let depth = 1;
  let i = idx + startMark.length;
  const start = i;

  while (i < text.length && depth > 0) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') depth--;
    i++;
  }

  if (depth !== 0) return undefined; // unclosed token — ignore
  return text.slice(start, i - 1).trim();
}

export function parseTokens(text: string): Tokens {
  // Extract all [EXEC: command] tokens (may appear multiple times)
  const execCommands: string[] = [];
  let searchFrom = 0;
  while (true) {
    const cmd = grabToken(text.slice(searchFrom), 'EXEC');
    if (!cmd) break;
    execCommands.push(cmd.trim());
    const idx = text.indexOf('[EXEC:', searchFrom);
    searchFrom = idx + 6 + cmd.length + 1; // advance past this token
  }

  const taskDoneRaw = grabToken(text, 'TASK_DONE');
  const taskDoneNum = taskDoneRaw ? parseInt(taskDoneRaw.trim(), 10) : undefined;

  return {
    question:    grabToken(text, 'QUESTION'),
    answer:      grabToken(text, 'ANSWER'),
    nextTask:    grabToken(text, 'NEXT_TASK'),
    correction:  grabToken(text, 'CORRECTION'),
    blocked:     grabToken(text, 'BLOCKED'),
    serveCommand: grabToken(text, 'SERVE'),
    execCommands,
    done:        /\[DONE\]/.test(text),
    complete:    /\[COMPLETE\]/.test(text),
    plan:        grabToken(text, 'PLAN'),
    taskDone:    (taskDoneNum && !isNaN(taskDoneNum)) ? taskDoneNum : undefined,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAgentRun(
  title: string,
  spec: string,
  config: AgentRunConfig,
): AgentRun {
  const specMsg =
    `Here is the project specification:\n\n---\n${spec}\n---\n\n` +
    `FIRST RESPONSE: Create a numbered plan (one-line titles only, max 15 tasks) and assign task 1 in the SAME response. ` +
    `Format:\n[PLAN:\n1. title\n2. title\n...]\n[NEXT_TASK: 1. title — what to build, key acceptance criteria, 100-150 words max]`;

  return {
    id: makeLogId(),
    title,
    spec,
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config,
    currentIteration: 0,
    workerHistory: [],
    // Seed manager history with the spec as the first user message
    managerHistory: [{ role: 'user', content: specMsg }],
    log: [logEntry('system', 'status', `Run created: "${title}"`, 'both')],
    nextStep: 'manager-init',
    checkpoints: [],
  };
}

// ─── Step Payload ─────────────────────────────────────────────────────────────

export interface StepPayload {
  /** Complete messages array to send to the Copilot API (system + history) */
  messages: AgentMessage[];
  isWorker: boolean;
  /** True if the history was trimmed to fit the context window */
  wasTrimmed?: boolean;
}

// GPT-4o has a 128k token context. Reserve 8k for completion.
// Use 3 chars/token (conservative estimate for mixed English + code).
const PROMPT_CHAR_BUDGET = 120_000 * 3; // 360 000 chars

/**
 * Trim a messages array to fit within the model's context window.
 *
 * Strategy:
 *  1. Keep messages[0] (system prompt) and messages[1] (original task/spec) always.
 *  2. Keep the most recent KEEP_RECENT messages so the agent has immediate context.
 *  3. Drop everything in between, inserting a single notice message.
 *  4. If still over budget, fall back to system + trim notice + last KEEP_RECENT only.
 */
export function trimToContextBudget(messages: AgentMessage[]): { messages: AgentMessage[]; trimmed: boolean } {
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  if (totalChars <= PROMPT_CHAR_BUDGET) return { messages, trimmed: false };

  const KEEP_RECENT = 8;

  // Not enough messages to meaningfully trim — return as-is.
  if (messages.length <= KEEP_RECENT + 2) return { messages, trimmed: false };

  const head = messages.slice(0, 2); // system prompt + first user message (original task)
  const tail = messages.slice(-KEEP_RECENT);
  const droppedCount = messages.length - head.length - KEEP_RECENT;

  const notice: AgentMessage = {
    role: 'system',
    content: `[${droppedCount} earlier message(s) removed to fit within the model context window. The original task and the ${KEEP_RECENT} most recent messages are preserved.]`,
  };

  const trimmed1 = [...head, notice, ...tail];
  if (trimmed1.reduce((s, m) => s + m.content.length, 0) <= PROMPT_CHAR_BUDGET) {
    return { messages: trimmed1, trimmed: true };
  }

  // Still over budget — keep only system prompt + trim notice + last KEEP_RECENT.
  const notice2: AgentMessage = {
    role: 'system',
    content: `[Earlier conversation heavily trimmed to fit the model context window. Showing the ${KEEP_RECENT} most recent messages only.]`,
  };
  return {
    messages: [messages[0], notice2, ...messages.slice(-KEEP_RECENT)],
    trimmed: true,
  };
}

/** Build the messages array to send for the current nextStep. */
export function getStepPayload(run: AgentRun): StepPayload | null {
  if (!run.nextStep) return null;

  const isWorker = run.nextStep === 'worker-execute';
  const prompts = getSystemPrompts(run.config.category);
  const systemContent = isWorker ? prompts.worker : prompts.manager;
  const history = isWorker ? run.workerHistory : run.managerHistory;

  const raw: AgentMessage[] = [{ role: 'system', content: systemContent }, ...history];
  const { messages, trimmed } = trimToContextBudget(raw);

  return { messages, isWorker, wasTrimmed: trimmed };
}

// ─── Apply Reply ──────────────────────────────────────────────────────────────

/**
 * Immutably apply an agent reply to the run, updating histories, logs,
 * nextStep, and status.
 */
export function applyReply(
  run: AgentRun,
  step: NonNullable<NextStep>,
  reply: string,
): AgentRun {
  const tokens = parseTokens(reply);
  const newLog: LogEntry[] = [];

  // ── Helper: update plan task statuses ────────────────────────────────────
  function applyPlanUpdates(
    plan: PlanTask[],
    taskDone?: number,
    nextTaskContent?: string,
    complete?: boolean,
  ): PlanTask[] {
    let updated = [...plan];

    // Mark [TASK_DONE: N] as done
    if (taskDone !== undefined) {
      updated = updated.map(t => t.id === taskDone ? { ...t, status: 'done' } : t);
    }

    // Detect task number from [NEXT_TASK: N. ...] prefix
    if (nextTaskContent) {
      const m = nextTaskContent.match(/^(\d+)[.\s]/);
      if (m) {
        const num = parseInt(m[1], 10);
        updated = updated.map(t => {
          if (t.id === num) return { ...t, status: 'in-progress' };
          // If a previous task was in-progress and we're moving on, mark it done
          if (t.id < num && t.status === 'in-progress') return { ...t, status: 'done' };
          return t;
        });
      }
    }

    // On [COMPLETE], mark all remaining pending/in-progress tasks as done
    if (complete) {
      updated = updated.map(t =>
        t.status === 'pending' || t.status === 'in-progress' ? { ...t, status: 'done' } : t,
      );
    }

    return updated;
  }

  // ── Manager responded ─────────────────────────────────────────────────────
  if (step !== 'worker-execute') {
    let newManagerHistory: AgentMessage[] = [
      ...run.managerHistory,
      { role: 'assistant', content: reply },
    ];

    // Add manager's full reply to manager panel
    const logType = step === 'manager-answer' ? 'answer' : 'directive';
    newLog.push(logEntry('manager', logType, reply, 'manager'));

    let nextStep: NextStep = null;
    let newWorkerHistory = run.workerHistory;
    let status: RunStatus = 'paused';

    // ── Parse [PLAN: ...] emitted on first manager response ────────────────
    let newPlan = run.plan ?? [];
    if (tokens.plan && newPlan.length === 0) {
      newPlan = parsePlanContent(tokens.plan);
      if (newPlan.length > 0) {
        newLog.push(logEntry('manager', 'status', `📋 Plan created with ${newPlan.length} tasks`, 'both'));
      }
    }

    // Apply [TASK_DONE: N] and status updates from [NEXT_TASK:] / [COMPLETE]
    if (newPlan.length > 0) {
      newPlan = applyPlanUpdates(newPlan, tokens.taskDone, tokens.nextTask, tokens.complete);
    }

    if (tokens.complete) {
      newLog.push(logEntry('system', 'status', '✅ Project complete! All tasks have been built.', 'both'));
      status = 'complete';

    } else if (tokens.nextTask) {
      newLog.push(logEntry('manager', 'task', tokens.nextTask, 'worker'));
      nextStep = 'worker-execute';
      status = 'running';
      newWorkerHistory = [
        ...run.workerHistory,
        { role: 'user', content: `Task: ${tokens.nextTask}` },
      ];

    } else if (tokens.answer) {
      newLog.push(logEntry('manager', 'answer', tokens.answer, 'both'));
      nextStep = 'worker-execute';
      status = 'running';
      newWorkerHistory = [
        ...run.workerHistory,
        { role: 'user', content: `[ANSWER: ${tokens.answer}]\n\nPlease continue with the task and end with [DONE] when complete.` },
      ];

    } else if (tokens.correction) {
      newLog.push(logEntry('manager', 'correction', tokens.correction, 'both'));
      nextStep = 'worker-execute';
      status = 'running';
      newWorkerHistory = [
        ...run.workerHistory,
        { role: 'user', content: `Corrections needed:\n[CORRECTION: ${tokens.correction}]\n\nPlease fix these issues and end with [DONE] when complete.` },
      ];

    } else {
      // No recognized action token.
      // Special case: manager emitted [PLAN:] but forgot [NEXT_TASK:] — give targeted recovery.
      const justCreatedPlan = tokens.plan && newPlan.length > 0;

      // Detect whether we already sent a recovery prompt (avoid infinite loop).
      const prevUserMsg = run.managerHistory[run.managerHistory.length - 1];
      const alreadyRecovered =
        prevUserMsg?.role === 'user' &&
        (prevUserMsg.content.startsWith('Your last response did not include') ||
         prevUserMsg.content.startsWith('You created the plan'));

      if (!alreadyRecovered) {
        let recoveryMsg: string;
        if (justCreatedPlan) {
          // Plan was just parsed but no [NEXT_TASK:] — tell manager exactly what to emit
          const firstTask = newPlan[0];
          newLog.push(logEntry('system', 'status',
            '⚠️ Plan created but no task assigned — prompting manager to assign task 1…', 'both'));
          recoveryMsg =
            `You created the plan but did not assign task 1. ` +
            `Your next response must assign task 1 immediately:\n\n` +
            `[NEXT_TASK: 1. ${firstTask?.title ?? 'first task'} — <what the worker must build, acceptance criteria, 100-150 words>]`;
        } else {
          newLog.push(logEntry('system', 'status',
            '⚠️ Manager reply had no recognized token — auto-recovering…', 'both'));
          recoveryMsg =
            `Your last response did not include any of the required tokens.\n` +
            `You MUST end your response with exactly one of:\n` +
            `- [NEXT_TASK: N. task title — brief description] (assign next task from your plan)\n` +
            `- [CORRECTION: exact changes needed]\n` +
            `- [ANSWER: your answer]  (only when replying to a worker question)\n` +
            `- [COMPLETE]  (only when every spec feature is fully implemented)\n\n` +
            `Please respond again now, ending with the correct token.`;
        }
        newManagerHistory = [...newManagerHistory, { role: 'user', content: recoveryMsg }];
        nextStep = step; // retry the exact same manager step
        status = 'running';
      } else {
        newLog.push(logEntry('system', 'status',
          '⏸ Manager produced no recognized token after auto-recovery. Run paused — use the steer box to guide it.',
          'both'));
      }
    }

    return {
      ...run,
      managerHistory: newManagerHistory,
      workerHistory: newWorkerHistory,
      log: [...run.log, ...newLog],
      nextStep,
      currentIteration: run.currentIteration + 1,
      updatedAt: Date.now(),
      status,
      plan: newPlan.length > 0 ? newPlan : run.plan,
    };
  }

  // ── Worker responded ──────────────────────────────────────────────────────
  const newWorkerHistory: AgentMessage[] = [
    ...run.workerHistory,
    { role: 'assistant', content: reply },
  ];

  newLog.push(logEntry('worker', 'output', reply, 'worker'));

  let nextStep: NextStep = null;
  let newManagerHistory = run.managerHistory;
  let pendingQuestion: string | undefined = run.pendingQuestion;
  let status: RunStatus = 'paused';

  if (tokens.blocked) {
    newLog.push(logEntry('system', 'status', `⛔ Worker blocked: ${tokens.blocked}`, 'both'));

  } else if (tokens.question) {
    newLog.push(logEntry('worker', 'question', tokens.question, 'both'));
    nextStep = 'manager-answer';
    pendingQuestion = tokens.question;
    status = 'running';
    newManagerHistory = [
      ...run.managerHistory,
      {
        role: 'user',
        content: `The worker has a question before continuing:\n"${tokens.question}"\n\nPlease provide a clear answer using: [ANSWER: your answer]`,
      },
    ];

  } else {
    // Worker done (with or without [DONE] token) → send to manager for review
    nextStep = 'manager-review';
    status = 'running';
    newManagerHistory = [
      ...run.managerHistory,
      {
        role: 'user',
        content:
          `Worker output for review:\n\n${reply}\n\n` +
          `Review this against the spec. Use:\n` +
          `- [NEXT_TASK: ...] to assign the next task\n` +
          `- [CORRECTION: ...] to request changes\n` +
          `- [COMPLETE] if all tasks in the spec are done`,
      },
    ];
  }

  return {
    ...run,
    workerHistory: newWorkerHistory,
    managerHistory: newManagerHistory,
    log: [...run.log, ...newLog],
    nextStep,
    pendingQuestion,
    currentIteration: run.currentIteration + 1,
    updatedAt: Date.now(),
    status,
  };
}
