'use client';
import { useMemo, useState } from 'react';
import type { AgentRun } from '@/services/agentOrchestrator';
import { extractFilesFromText, type ParsedFile } from '@/utils/fileParser';

// ─── Worker file parser ────────────────────────────────────────────────────
/**
 * Scans worker output log entries first; falls back to raw workerHistory
 * assistant messages if the log scan finds nothing.
 */
function parseWorkerFiles(run: AgentRun): ParsedFile[] {
  const fileMap = new Map<string, ParsedFile>();

  for (const entry of run.log) {
    if (entry.from === 'worker' && entry.type === 'output')
      extractFilesFromText(entry.content, fileMap);
  }

  // Fallback: raw conversation history
  if (fileMap.size === 0) {
    for (const msg of run.workerHistory) {
      if (msg.role === 'assistant')
        extractFilesFromText(msg.content, fileMap);
    }
  }

  return Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function downloadSingleFile(file: ParsedFile) {
  const blob = new Blob([file.content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = file.path.split('/').pop() ?? file.path;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadAllAsZip(files: ParsedFile[], runTitle: string) {
  const JSZip  = (await import('jszip')).default;
  const zip    = new JSZip();
  for (const f of files) zip.file(f.path, f.content);
  const blob   = await zip.generateAsync({ type: 'blob' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `${runTitle.replace(/[^a-z0-9]/gi, '_')}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── File tree helpers ────────────────────────────────────────────────────────

/** Group files into a simple tree: top-level dirs as keys, files inside */
function buildTree(files: ParsedFile[]) {
  const tree: Record<string, ParsedFile[]> = {};
  for (const f of files) {
    const parts = f.path.split('/');
    const dir   = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(f);
  }
  return Object.entries(tree).sort(([a], [b]) => a.localeCompare(b));
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  run:     AgentRun;
  onClose: () => void;
}

export default function FilesModal({ run, onClose }: Props) {
  const files    = useMemo(() => parseWorkerFiles(run), [run]);
  const tree     = useMemo(() => buildTree(files), [files]);
  const [selected, setSelected]       = useState<ParsedFile | null>(files[0] ?? null);
  const [downloading, setDownloading] = useState(false);
  const [openedFile, setOpenedFile]   = useState<string | null>(null);

  const workspaceFolder = `/home/coder/workspace/${run.id}`;

  async function openInCodeServer(relPath: string) {
    const folderParam = encodeURIComponent(workspaceFolder);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2_000);
      const res = await fetch('/api/exec/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.id, filePath: relPath }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        // Bridge opened the file in the existing code-server tab — flash the button
        setOpenedFile(relPath);
        setTimeout(() => setOpenedFile(null), 2_000);
        return;
      }
    } catch { /* fall through */ }
    // Bridge unavailable — open code-server folder in new tab
    window.open(`http://localhost:8080/?folder=${folderParam}`, '_blank', 'noopener,noreferrer');
  }

  if (files.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4">
          <h2 className="text-lg font-bold mb-2">No files found</h2>
          <p className="text-gray-500 text-sm mb-4">
            No code files were detected in the worker output. Files are extracted from fenced code
            blocks with a file path in the header, as a first-line comment, or annotated before the
            block—e.g.&nbsp;
            <code className="bg-gray-100 px-1 rounded text-xs">```tsx src/App.tsx</code>
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
          <span className="text-base">📁</span>
          <span className="font-bold text-gray-800 truncate max-w-xs">{run.title}</span>
          <span className="text-xs text-gray-400 shrink-0">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex gap-2 shrink-0">
            <button
              onClick={async () => {
                setDownloading(true);
                try { await downloadAllAsZip(files, run.title); }
                finally { setDownloading(false); }
              }}
              disabled={downloading}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {downloading ? 'Packaging…' : '⬇ Download All (.zip)'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold rounded border text-gray-600 hover:bg-gray-50"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* File tree */}
          <div className="w-60 shrink-0 border-r overflow-y-auto bg-gray-50 py-2">
            {tree.map(([dir, dirFiles]) => (
              <div key={dir || '/'}>
                {dir && (
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate">
                    {dir}/
                  </div>
                )}
                {dirFiles.map(f => {
                  const name = f.path.split('/').pop() ?? f.path;
                  return (
                    <button
                      key={f.path}
                      onClick={() => setSelected(f)}
                      title={f.path}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors ${
                        selected?.path === f.path
                          ? 'bg-blue-100 text-blue-800 font-semibold'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {dir ? `  ${name}` : name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Code viewer */}
          {selected && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* File bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b bg-white shrink-0">
                <code className="text-xs text-gray-600 font-mono flex-1 truncate">{selected.path}</code>
                <span className="text-[10px] text-gray-400 shrink-0">
                  {selected.content.split('\n').length} lines
                </span>
                <button
                  onClick={() => openInCodeServer(selected.path)}
                  title={`Open ${selected.path} in code-server`}
                  className={`flex items-center gap-1 text-xs font-semibold shrink-0 transition-colors ${
                    openedFile === selected.path
                      ? 'text-emerald-600'
                      : 'text-indigo-600 hover:text-indigo-800'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.186.186 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.185v1.888c0 .101.083.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
                  </svg>
                  {openedFile === selected.path ? '✓ Opened' : 'Open in code-server'}
                </button>
                <button
                  onClick={() => downloadSingleFile(selected)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold shrink-0"
                >
                  ⬇ Download
                </button>
              </div>
              {/* Code */}
              <pre className="flex-1 overflow-auto p-4 text-xs font-mono bg-gray-950 text-gray-100 leading-relaxed whitespace-pre">
                {selected.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
