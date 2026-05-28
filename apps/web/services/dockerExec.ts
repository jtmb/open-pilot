// services/dockerExec.ts
// Executes commands inside the code-server Docker container via the Docker
// Engine API over the Unix socket at /var/run/docker.sock.
// No external npm packages required — uses Node.js built-in `http` module.

import * as http from 'http';

const SOCKET_PATH = '/var/run/docker.sock';
const WORKSPACE_ROOT = '/home/coder/workspace';

// ─── Low-level Docker HTTP helpers ───────────────────────────────────────────

function dockerRequest(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Start an exec instance and collect stdout+stderr.
 * Docker multiplexed stream: each frame has an 8-byte header.
 *   Byte 0:   stream type (1=stdout, 2=stderr)
 *   Bytes 1-3: reserved
 *   Bytes 4-7: payload size (big-endian uint32)
 */
function startExecAndCollect(execId: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ Detach: false, Tty: false });
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: `/exec/${execId}/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
          req.destroy();
          resolve('[timeout]');
        }, timeoutMs);

        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks);
          let output = '';
          let offset = 0;
          // Parse Docker multiplexed stream frames
          while (offset + 8 <= raw.length) {
            const frameSize = raw.readUInt32BE(offset + 4);
            if (offset + 8 + frameSize > raw.length) break;
            output += raw.slice(offset + 8, offset + 8 + frameSize).toString('utf8');
            offset += 8 + frameSize;
          }
          // Fallback: if no valid frames parsed, treat raw as plain text
          if (output === '' && raw.length > 0) {
            output = raw.toString('utf8');
          }
          resolve(output.slice(0, 32_000)); // cap output length
        });
        res.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Container discovery ──────────────────────────────────────────────────────

let cachedContainerId: string | null = null;

export async function findCodeServerContainer(): Promise<string> {
  if (cachedContainerId) return cachedContainerId;

  const filters = encodeURIComponent(
    JSON.stringify({ label: ['com.docker.compose.service=code-server'] }),
  );
  const { status, body } = await dockerRequest('GET', `/containers/json?filters=${filters}`);
  if (status !== 200) throw new Error(`Docker API error ${status}: ${body}`);

  const containers = JSON.parse(body) as Array<{ Id: string }>;
  if (containers.length === 0) throw new Error('code-server container not found');

  cachedContainerId = containers[0].Id;
  return cachedContainerId;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ExecResult {
  output:   string;
  exitCode: number;
}

/**
 * Run a shell command inside the code-server container.
 * @param command  Shell command string (passed to `sh -c`)
 * @param cwd      Working directory inside the container
 * @param timeoutMs  Max time to wait for the command (default 60s)
 */
export async function runInContainer(
  command: string,
  cwd: string,
  timeoutMs = 60_000,
): Promise<ExecResult> {
  const containerId = await findCodeServerContainer();

  // Create exec instance
  const createRes = await dockerRequest('POST', `/containers/${containerId}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ['bash', '-c', command],
    WorkingDir: cwd,
  });
  if (createRes.status !== 201) {
    throw new Error(`Failed to create exec: ${createRes.status} ${createRes.body}`);
  }

  const { Id: execId } = JSON.parse(createRes.body) as { Id: string };

  // Start and collect output
  const output = await startExecAndCollect(execId, timeoutMs);

  // Get exit code
  const inspectRes = await dockerRequest('GET', `/exec/${execId}/json`);
  const exitCode: number =
    inspectRes.status === 200
      ? (JSON.parse(inspectRes.body) as { ExitCode: number }).ExitCode
      : -1;

  return { output, exitCode };
}

/**
 * Write a file inside the code-server container at:
 *   WORKSPACE_ROOT/<runId>/<filePath>
 *
 * Uses base64-encoded content piped through `base64 -d` to avoid
 * shell escaping issues. mkdir -p ensures parent dirs exist.
 */
export async function writeFileToContainer(
  runId: string,
  filePath: string,
  content: string,
): Promise<void> {
  // Sanitize runId — only allow safe characters to prevent path traversal
  if (!/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    throw new Error('Invalid runId');
  }
  // Sanitize filePath — must not contain ..
  const cleanPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
  if (cleanPath.includes('..')) {
    throw new Error('Invalid file path');
  }

  const fullPath = `${WORKSPACE_ROOT}/${runId}/${cleanPath}`;
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  const b64 = Buffer.from(content, 'utf8').toString('base64');

  // mkdir -p + write via base64 decode
  // Use /home/coder as CWD — WORKSPACE_ROOT may not exist yet
  const cmd = `mkdir -p '${dir}' && printf '%s' '${b64}' | base64 -d > '${fullPath}'`;
  const result = await runInContainer(cmd, '/home/coder', 15_000);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write file ${cleanPath}: ${result.output}`);
  }
}

/**
 * Write multiple files to the container workspace for a given run.
 */
export async function writeFilesToContainer(
  runId: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    await writeFileToContainer(runId, file.path, file.content);
  }
}

// ─── Preview server management ────────────────────────────────────────────────

// Port pool: each active run gets its own port so concurrent previews don't
// collide. Ports 4000–4019 are exposed from the code-server container.
const PREVIEW_PORT_START = 4000;
const PREVIEW_PORT_COUNT = 20;

const freePorts = new Set<number>(
  Array.from({ length: PREVIEW_PORT_COUNT }, (_, i) => PREVIEW_PORT_START + i),
);

/** Maps runId → allocated preview port. */
const runPorts = new Map<string, number>();

/** Maps runId → PID of the running preview process. */
const previewPids = new Map<string, number>();

/** Returns the port allocated for the given run, if any. */
export function getRunPort(runId: string): number | undefined {
  return runPorts.get(runId);
}

/**
 * Start a long-running preview server inside the code-server container.
 * Each run gets a unique port from the pool so concurrent previews don't
 * conflict. If the run already has an allocated port, that port is reused.
 *
 * The worker always declares its serve command using port 4000 (per system
 * prompt instructions). Any occurrence of "4000" in the command string is
 * transparently replaced with the allocated port before execution.
 *
 * @returns The preview URL (e.g. http://localhost:4001)
 */
export async function startPreviewServer(
  runId: string,
  command: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9_\-]+$/.test(runId)) throw new Error('Invalid runId');

  // Allocate (or reuse) a port for this run.
  let port = runPorts.get(runId);
  if (port === undefined) {
    const next = freePorts.values().next();
    if (next.done) throw new Error('All preview ports are in use. Try again later.');
    port = next.value;
    freePorts.delete(port);
    runPorts.set(runId, port);
  }

  // Kill any previous process for this run on its assigned port.
  await stopPreviewServer(runId, /* releasePort */ false);

  // Re-register the port (stopPreviewServer may have cleared it when releasePort=false still clears the pid).
  runPorts.set(runId, port);

  // Replace any hardcoded port 4000 references in the command with the allocated port.
  const portedCommand = port === 4000
    ? command
    : command.replace(/\b4000\b/g, String(port));

  const cwd = `${WORKSPACE_ROOT}/${runId}`;
  const logFile = `/tmp/preview-${runId}.log`;

  // Run command detached; echo PID to stdout so we can capture it.
  const bgCmd = `cd '${cwd}' && nohup sh -c ${JSON.stringify(portedCommand)} > '${logFile}' 2>&1 & echo $!`;
  const result = await runInContainer(bgCmd, WORKSPACE_ROOT, 10_000);
  const pid = parseInt(result.output.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Failed to start preview server (output: ${result.output.trim()})`);
  }

  previewPids.set(runId, pid);
  return `http://localhost:${port}`;
}

/**
 * Stop the preview server for a run and optionally return its port to the pool.
 * Pass releasePort=false when stopping before a restart (keeps the port reserved).
 */
export async function stopPreviewServer(
  runId: string,
  releasePort = true,
): Promise<void> {
  const pid = previewPids.get(runId);
  const port = runPorts.get(runId);
  previewPids.delete(runId);

  if (releasePort) {
    runPorts.delete(runId);
    if (port !== undefined) freePorts.add(port);
  }

  const killCmd = pid
    ? `kill -9 ${pid} 2>/dev/null; ${port !== undefined ? `kill $(lsof -ti:${port} 2>/dev/null) 2>/dev/null;` : ''} true`
    : port !== undefined
      ? `kill $(lsof -ti:${port} 2>/dev/null) 2>/dev/null; true`
      : 'true';

  // Use /home/coder as CWD — workspace may not exist at stop time.
  await runInContainer(killCmd, '/home/coder', 10_000);
}
