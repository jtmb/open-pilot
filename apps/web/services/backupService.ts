// services/backupService.ts
// SQLite auto-backup: periodic copies of the database file, kept at /data/backups/

import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL?.replace(/^file:/, '') ?? '/data/openpilot.db';
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const MAX_BACKUPS = 10;
const AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export interface BackupInfo {
  filename: string;
  createdAt: number; // Unix ms
  size: number;       // bytes
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Copy the live database to a timestamped backup file. */
export function backupDatabase(): BackupInfo {
  ensureBackupDir();

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database file not found at ${DB_PATH}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `openpilot_${ts}.db`;
  const dest = path.join(BACKUP_DIR, filename);

  fs.copyFileSync(DB_PATH, dest);

  const stat = fs.statSync(dest);
  const info: BackupInfo = { filename, createdAt: stat.ctimeMs, size: stat.size };

  // Prune oldest backups, keeping only MAX_BACKUPS
  pruneOldBackups();

  return info;
}

/** List all backups sorted newest-first. */
export function listBackups(): BackupInfo[] {
  ensureBackupDir();
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
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
  if (!filename.endsWith('.db')) {
    throw new Error('Invalid backup file extension');
  }
  return path.join(BACKUP_DIR, filename);
}

/** Replace the live database with a backup file, then reconnect Prisma. */
export async function restoreBackup(filename: string): Promise<void> {
  const src = getBackupPath(filename);
  if (!fs.existsSync(src)) throw new Error('Backup file not found');

  // Disconnect Prisma so it releases its file handle
  const { prisma } = await import('../lib/prisma');
  await prisma.$disconnect();

  fs.copyFileSync(src, DB_PATH);

  // Reconnect by importing fresh (Next.js dev mode re-uses global, prod does new instance)
  await prisma.$connect();
}

/** Import an externally-supplied .db file as the live database. */
export async function importDatabase(buffer: Buffer): Promise<void> {
  if (!DB_PATH) throw new Error('DATABASE_URL not set');

  // Validate SQLite magic bytes
  const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
  if (!buffer.slice(0, 16).equals(SQLITE_MAGIC)) {
    throw new Error('File does not appear to be a valid SQLite database');
  }

  const { prisma } = await import('../lib/prisma');
  await prisma.$disconnect();

  fs.writeFileSync(DB_PATH, buffer);

  await prisma.$connect();
}

function pruneOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    files.slice(MAX_BACKUPS).forEach(({ f }) => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

// ── Auto-backup scheduler (started once per server process) ──────────────────
let _autoBackupStarted = false;

export function startAutoBackup() {
  if (_autoBackupStarted) return;
  _autoBackupStarted = true;

  // Run once shortly after startup, then on interval
  const run = () => {
    try { backupDatabase(); } catch { /* ignore startup errors (DB may not exist yet) */ }
  };

  setTimeout(run, 30_000); // 30s after startup
  setInterval(run, AUTO_INTERVAL_MS);
}
