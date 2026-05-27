import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

const BACKUP_DIR = process.env.BACKUP_DIR ?? '/data/backups';
const CONFIG_PATH = process.env.BACKUP_CONFIG_PATH ?? '/data/backup-config.json';
const MAX_BACKUPS = 10;

interface BackupPayload {
  version: 1;
  exportedAt: number;
  datasource: string;
  conversations: Array<{
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: string;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  apiKeys: Array<{
    id: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    model: string;
    enabled: boolean;
    createdAt: number;
    lastUsedAt: number | null;
    usageCount: number;
  }>;
}

// ── Backup config ─────────────────────────────────────────────────────────────

export interface BackupConfig {
  enabled: boolean;
  /** How often to auto-backup, in hours */
  intervalHours: number;
}

const DEFAULT_CONFIG: BackupConfig = { enabled: true, intervalHours: 6 };

export function getAutoBackupConfig(): BackupConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

export function setAutoBackupConfig(patch: Partial<BackupConfig>): BackupConfig {
  const next = { ...getAutoBackupConfig(), ...patch };
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8'); } catch { /* ignore */ }
  _restartTimer(next);
  return next;
}

export interface BackupInfo {
  filename: string;
  createdAt: number; // Unix ms
  size: number;       // bytes
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function safeNumber(value: bigint | number | null): number {
  if (value == null) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

async function buildBackupPayload(): Promise<BackupPayload> {
  const [conversations, users, apiKeys] = await Promise.all([
    prisma.conversation.findMany(),
    prisma.user.findMany(),
    prisma.apiKey.findMany(),
  ]);

  return {
    version: 1,
    exportedAt: Date.now(),
    datasource: process.env.DATABASE_URL?.split(':')[0] ?? 'unknown',
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: safeNumber(c.createdAt),
      updatedAt: safeNumber(c.updatedAt),
      messages: c.messages,
    })),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: safeNumber(u.createdAt),
      updatedAt: safeNumber(u.updatedAt),
    })),
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      keyHash: k.keyHash,
      keyPrefix: k.keyPrefix,
      model: k.model,
      enabled: k.enabled,
      createdAt: safeNumber(k.createdAt),
      lastUsedAt: k.lastUsedAt == null ? null : safeNumber(k.lastUsedAt),
      usageCount: k.usageCount,
    })),
  };
}

/** Create and store a timestamped logical backup as JSON. */
export async function backupDatabase(): Promise<BackupInfo> {
  ensureBackupDir();

  const payload = await buildBackupPayload();
  const ts = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `openpilot_${ts}.json`;
  const dest = path.join(BACKUP_DIR, filename);

  fs.writeFileSync(dest, JSON.stringify(payload), 'utf8');

  const stat = fs.statSync(dest);
  const info: BackupInfo = { filename, createdAt: stat.ctimeMs, size: stat.size };
  pruneOldBackups();
  return info;
}

/** List all backups sorted newest-first. */
export function listBackups(): BackupInfo[] {
  ensureBackupDir();
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(filename => {
        const stat = fs.statSync(path.join(BACKUP_DIR, filename));
        return { filename, createdAt: stat.ctimeMs, size: stat.size };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Get the absolute path of a named backup file (validates it stays within backup dir). */
export function getBackupPath(filename: string): string {
  // Reject path traversal attempts
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid backup filename');
  }
  if (!filename.endsWith('.json')) {
    throw new Error('Invalid backup file extension');
  }
  return path.join(BACKUP_DIR, filename);
}

async function applyBackupPayload(payload: BackupPayload): Promise<void> {
  if (!Array.isArray(payload.conversations) || !Array.isArray(payload.users) || !Array.isArray(payload.apiKeys)) {
    throw new Error('Invalid backup payload');
  }

  await prisma.$transaction(async (tx) => {
    await tx.conversation.deleteMany();
    await tx.user.deleteMany();
    await tx.apiKey.deleteMany();

    if (payload.conversations.length > 0) {
      await tx.conversation.createMany({
        data: payload.conversations.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: BigInt(c.createdAt),
          updatedAt: BigInt(c.updatedAt),
          messages: c.messages,
        })),
      });
    }

    if (payload.users.length > 0) {
      await tx.user.createMany({
        data: payload.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          image: u.image,
          createdAt: BigInt(u.createdAt),
          updatedAt: BigInt(u.updatedAt),
        })),
      });
    }

    if (payload.apiKeys.length > 0) {
      await tx.apiKey.createMany({
        data: payload.apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          keyHash: k.keyHash,
          keyPrefix: k.keyPrefix,
          model: k.model,
          enabled: k.enabled,
          createdAt: BigInt(k.createdAt),
          lastUsedAt: k.lastUsedAt == null ? null : BigInt(k.lastUsedAt),
          usageCount: k.usageCount,
        })),
      });
    }
  });
}

/** Restore DB content from a named JSON backup. */
export async function restoreBackup(filename: string): Promise<void> {
  const src = getBackupPath(filename);
  if (!fs.existsSync(src)) throw new Error('Backup file not found');

  const raw = fs.readFileSync(src, 'utf8');
  const parsed = JSON.parse(raw) as BackupPayload;
  await applyBackupPayload(parsed);
}

/** Export current DB content as a downloadable JSON payload. */
export async function exportDatabase(): Promise<{ filename: string; buffer: Buffer }> {
  const payload = await buildBackupPayload();
  const ts = new Date(payload.exportedAt).toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `openpilot_${ts}.json`;
  return {
    filename,
    buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
  };
}

/** Import an externally-supplied JSON backup payload. */
export async function importDatabase(buffer: Buffer): Promise<void> {
  const raw = buffer.toString('utf8').trim();
  if (!raw) throw new Error('Uploaded backup is empty');
  const parsed = JSON.parse(raw) as BackupPayload;
  await applyBackupPayload(parsed);
}

function pruneOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    files.slice(MAX_BACKUPS).forEach(({ f }) => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

// ── Auto-backup scheduler ─────────────────────────────────────────────────────

let _autoBackupStarted = false;
let _timer: ReturnType<typeof setInterval> | null = null;

function _run() {
  const cfg = getAutoBackupConfig();
  if (!cfg.enabled) return;
  void backupDatabase().catch(() => {
    // Ignore transient backup errors to keep timer alive.
  });
}

function _restartTimer(cfg: BackupConfig) {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (!cfg.enabled) return;
  _timer = setInterval(_run, cfg.intervalHours * 60 * 60 * 1000);
}

export function startAutoBackup() {
  if (_autoBackupStarted) return;
  _autoBackupStarted = true;

  // Run a startup backup immediately (non-blocking, errors swallowed)
  setImmediate(_run);

  const cfg = getAutoBackupConfig();
  _restartTimer(cfg);
}

