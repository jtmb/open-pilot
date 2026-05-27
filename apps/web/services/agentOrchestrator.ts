// services/agentOrchestrator.ts
// Types, system prompts, token parsing, and state transitions for the
// Worker ↔ Manager agent orchestration loop.

import personalitiesData from '../data/personalities.json';

export type PersonalityId = 'developer' | 'designer' | 'writer';

export interface PersonalityDef {
  id: PersonalityId;
  label: string;
  icon: string;
  description: string;
  workerSystem: string;
  managerSystem: string;
}

/** All available agent personalities loaded from data/personalities.json */
export const personalities = personalitiesData as Record<PersonalityId, PersonalityDef>;

/** Return the worker/manager system prompts for the given category. Defaults to 'developer'. */
export function getSystemPrompts(category?: string): { worker: string; manager: string } {
  const id = (category && category in personalities ? category : 'developer') as PersonalityId;
  const p = personalities[id];
  return { worker: p.workerSystem, manager: p.managerSystem };
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
  /** Git-backed workspace snapshots, auto-created after each successful exec */
  checkpoints?: Checkpoint[];
}

// ─── System Prompts ──────────────────────────────────────────────────────────

export const WORKER_SYSTEM = `You are a skilled software engineer working autonomously on an app development project. A manager agent assigns you tasks from a specification document.

For each task:
1. Implement it fully with complete, working code.
2. Show each file in a fenced code block with the file path on the first line, e.g.:
   \`\`\`typescript src/components/Navbar.tsx
   // code here
   \`\`\`
3. Never use placeholders, TODOs, or "// implement this later" — write real, runnable code.
4. If you have a clarifying question, include it as: [QUESTION: your question here]
5. You have a terminal in your workspace. Use [EXEC: command] to run shell commands:
   - Install dependencies:  [EXEC: npm install]
   - Build:                 [EXEC: npm run build]
   - Run tests:             [EXEC: npm test]
   - Any shell command:     [EXEC: node -e "console.log('hi')"]
   All code files you output are automatically synced to your workspace before each command runs.
   After receiving the command output, fix any errors and run again until it passes.
6. Once the project can be served or previewed, declare the serve command on port 4000 with:
   [SERVE: <command>]  e.g.  [SERVE: npx serve -p 4000 dist]
   Always use port 4000. Use whatever server fits the project type.
   This unlocks a live preview button for the user — include it as soon as the first successful build.
7. End your response with [DONE] when you have completed the task (and any build/tests pass).
8. If you are completely blocked and cannot continue, end with [BLOCKED: reason].
9. The workspace contains AGENTS.md and CLAUDE.md. After completing each significant feature, update the **Architecture**, **Build & Run**, and **Testing** sections of AGENTS.md to reflect the current state of the project.

Write production-quality code. Never truncate or omit code.`;

export const MANAGER_SYSTEM = `You are a technical project manager and senior code reviewer working with an autonomous software engineer (the worker agent).

Your responsibilities:
1. On first message: Read the specification carefully and assign the FIRST concrete task using exactly: [NEXT_TASK: detailed task description with all context the worker needs]
2. After each worker response: Review the code against the specification.
3. If the code meets the spec: Acknowledge briefly and assign the next task with [NEXT_TASK: ...]
4. If there are issues: Request specific changes with [CORRECTION: exactly what to change and why]
5. Answer worker questions clearly with: [ANSWER: your answer]
6. When ALL features in the specification have been implemented and reviewed: end with [COMPLETE]

Rules:
- Assign exactly ONE task at a time — do not batch multiple features in one [NEXT_TASK]
- Be specific: include all necessary context in [NEXT_TASK] so the worker doesn't need to ask basic questions
- In [CORRECTION], name the exact file, function, or line that needs changing
- Do not emit [COMPLETE] until every feature in the spec is implemented and reviewed
- CRITICAL: Every response you produce MUST end with exactly one of the tokens above. Never write a response that does not end with [NEXT_TASK:...], [CORRECTION:...], [ANSWER:...], or [COMPLETE]. Keep your analysis brief — emit the token as early as possible.
- The workspace contains AGENTS.md with documentation. When reviewing completed tasks, verify that the worker kept AGENTS.md up to date (architecture, build, testing sections). If not, include updating it in the next [NEXT_TASK] or [CORRECTION].`;

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
    `Please analyze the spec and assign the FIRST task to the worker using exactly: ` +
    `[NEXT_TASK: detailed task description with all context]`;

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
}

/** Build the messages array to send for the current nextStep. */
export function getStepPayload(run: AgentRun): StepPayload | null {
  if (!run.nextStep) return null;

  const isWorker = run.nextStep === 'worker-execute';
  const prompts = getSystemPrompts(run.config.category);
  const systemContent = isWorker ? prompts.worker : prompts.manager;
  const history = isWorker ? run.workerHistory : run.managerHistory;

  return {
    messages: [{ role: 'system', content: systemContent }, ...history],
    isWorker,
  };
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
      // No recognized token — auto-recover once before giving up.
      // Check whether the message that prompted this reply was already a recovery prompt.
      const prevUserMsg = run.managerHistory[run.managerHistory.length - 1];
      const alreadyRecovered =
        prevUserMsg?.role === 'user' &&
        prevUserMsg.content.startsWith('Your last response did not include');

      if (!alreadyRecovered) {
        newLog.push(logEntry('system', 'status',
          '⚠️ Manager reply had no recognized token — auto-recovering…', 'both'));
        const recoveryMsg =
          `Your last response did not include any of the required tokens.\n` +
          `You MUST end your response with exactly one of:\n` +
          `- [NEXT_TASK: detailed task description]\n` +
          `- [CORRECTION: exact changes needed]\n` +
          `- [ANSWER: your answer]  (only when replying to a worker question)\n` +
          `- [COMPLETE]  (only when every spec feature is fully implemented)\n\n` +
          `Please respond again now, ending with the correct token.`;
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
