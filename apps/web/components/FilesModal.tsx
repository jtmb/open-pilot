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
