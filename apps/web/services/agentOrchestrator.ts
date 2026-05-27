// services/agentOrchestrator.ts
// Types, system prompts, token parsing, and state transitions for the
// Worker ↔ Manager agent orchestration loop.

// ─── Types ───────────────────────────────────────────────────────────────────

export type RunStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

export type NextStep =
  | 'manager-init'    // manager reads spec and assigns first task
  | 'worker-execute'  // worker receives task and builds
  | 'manager-review'  // manager reviews worker output
  | 'manager-answer'  // manager answers worker question
  | null;

export type LogEntryType =
  | 'task'        // manager assigns a task to worker
  | 'output'      // worker produces code/output
  | 'question'    // worker asks manager a question
  | 'answer'      // manager answers worker question
  | 'review'      // manager's full review response
  | 'correction'  // manager requests corrections
  | 'directive'   // manager's full response (task assignment etc.)
  | 'status'      // system/status message
  | 'user-input'; // user injection

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
}

export interface AgentRunConfig {
  workerModel: string;
  workerReasoningEffort: string;
  managerModel: string;
  managerReasoningEffort: string;
  maxIterations: number;
  approvalMode: 'approvals' | 'bypass' | 'autopilot';
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
5. End your response with [DONE] when you have completed the task.
6. If you are completely blocked and cannot continue, end with [BLOCKED: reason].

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
- Do not emit [COMPLETE] until every feature in the spec is implemented and reviewed`;

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
  question?:   string;
  answer?:     string;
  nextTask?:   string;
  correction?: string;
  blocked?:    string;
  done:        boolean;
  complete:    boolean;
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
  return {
    question:   grabToken(text, 'QUESTION'),
    answer:     grabToken(text, 'ANSWER'),
    nextTask:   grabToken(text, 'NEXT_TASK'),
    correction: grabToken(text, 'CORRECTION'),
    blocked:    grabToken(text, 'BLOCKED'),
    done:       /\[DONE\]/.test(text),
    complete:   /\[COMPLETE\]/.test(text),
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
  const systemContent = isWorker ? WORKER_SYSTEM : MANAGER_SYSTEM;
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
    const newManagerHistory: AgentMessage[] = [
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
      newLog.push(logEntry('system', 'status', '⏸ Manager response contained no recognized token. Run paused — use the steer box to guide it.', 'both'));
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
