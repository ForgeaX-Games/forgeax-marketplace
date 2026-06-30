/**
 * Doc 09 §2.1 — wb-plugin-author panel (gap 7 of IMPLEMENTATION-COVERAGE).
 *
 * Minimal in-app editor for L2 plugins under <projectRoot>/.forgeax/plugins/<slug>/.
 *
 *   - Left:  flat file tree from GET /api/plugins/files?slug=<slug>
 *   - Right: textarea editor; save -> PUT /api/plugins/files (server reloads
 *     the registry in the background); manual reload via POST /api/plugins/reload
 *
 * Why textarea, not Monaco? Monaco roughly doubles the host bundle and pulls
 * in web workers — not worth it before the rest of the authoring loop is
 * proven. Once authors regularly use this panel, swapping in @monaco-editor
 * is mechanical (the file get/put API stays the same).
 *
 * Mount paths:
 *   - PanelComponent (default export) — direct React import from the host
 *     bundle (interface's WorkbenchPluginHost). This is the path we use
 *     today; no separate iframe build needed.
 *   - render(target) — Phase 6+ entry.frontend path for when the host loads
 *     plugins via createPluginPort + dynamic ESM. Renders the same component
 *     into the supplied DOM node and returns an unmount handle.
 */
import { useEffect, useState, useMemo } from 'react';
import type { ReactElement } from 'react';

interface FileEntry {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

const PROJECT_ROOT_HINT =
  'Reads/writes under .forgeax/plugins/<slug>/. slug is the directory name produced by record-as-skill or fork.';

export interface WorkbenchPanelHandle {
  unmount(): void;
}

export function PluginAuthorPanel(): ReactElement {
  const [slugInput, setSlugInput] = useState<string>('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [origContent, setOrigContent] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reloadState, setReloadState] = useState<'idle' | 'reloading' | 'done' | 'error'>('idle');

  const dirty = useMemo(() => content !== origContent, [content, origContent]);

  async function loadList(slug: string) {
    setListError(null);
    setEntries([]);
    try {
      const r = await fetch(`/api/plugins/files?slug=${encodeURIComponent(slug)}`);
      const j = (await r.json()) as
        | { ok: true; entries: FileEntry[]; pluginDir: string }
        | { ok: false; error: string; code?: string };
      if (!j.ok) {
        setListError(j.error);
        return;
      }
      setEntries(j.entries);
      setActiveSlug(slug);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadFile(slug: string, path: string) {
    setFileError(null);
    setSavingState('idle');
    try {
      const r = await fetch(
        `/api/plugins/files?slug=${encodeURIComponent(slug)}&path=${encodeURIComponent(path)}`,
      );
      const j = (await r.json()) as
        | { ok: true; content: string; path: string }
        | { ok: false; error: string };
      if (!j.ok) {
        setFileError(j.error);
        setActiveFile(null);
        setContent('');
        setOrigContent('');
        return;
      }
      setActiveFile(j.path);
      setContent(j.content);
      setOrigContent(j.content);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save() {
    if (!activeSlug || !activeFile) return;
    setSavingState('saving');
    try {
      const r = await fetch('/api/plugins/files', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: activeSlug, path: activeFile, content }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) {
        setSavingState('error');
        setFileError(j.error ?? 'save failed');
        return;
      }
      setOrigContent(content);
      setSavingState('saved');
      setTimeout(() => setSavingState('idle'), 1500);
    } catch (e) {
      setSavingState('error');
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  async function reload() {
    setReloadState('reloading');
    try {
      const r = await fetch('/api/plugins/reload', { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok === false) {
        setReloadState('error');
        setFileError(j.error ?? 'reload failed');
        return;
      }
      setReloadState('done');
      setTimeout(() => setReloadState('idle'), 1500);
    } catch (e) {
      setReloadState('error');
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!activeSlug) return;
    loadList(activeSlug);
  }, [activeSlug]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--fx-border, #2a2a2a)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: 'var(--fx-fg-muted, #aaa)', fontSize: 12 }}>plugin slug:</span>
        <input
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder="e.g. replay-greet"
          style={{ flex: '0 0 220px', padding: '4px 8px', background: 'var(--fx-bg-elev2, #1c1c1c)', color: 'var(--fx-fg, #ddd)', border: '1px solid var(--fx-border, #333)', borderRadius: 3, fontSize: 12 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && slugInput.trim()) loadList(slugInput.trim()); }}
        />
        <button
          onClick={() => slugInput.trim() && loadList(slugInput.trim())}
          style={{ padding: '4px 10px', background: 'var(--fx-bg-elev1, #2a2a2a)', color: 'var(--fx-fg, #ddd)', border: '1px solid var(--fx-border, #444)', borderRadius: 3, fontSize: 12, cursor: 'pointer' }}
        >
          Load
        </button>
        <button
          onClick={reload}
          disabled={reloadState === 'reloading'}
          style={{ padding: '4px 10px', background: 'var(--fx-bg-elev1, #2a2a2a)', color: 'var(--fx-fg, #ddd)', border: '1px solid var(--fx-border, #444)', borderRadius: 3, fontSize: 12, cursor: 'pointer' }}
          title="POST /api/plugins/reload"
        >
          {reloadState === 'reloading' ? 'Reloading...' : reloadState === 'done' ? 'Reloaded' : 'Reload registry'}
        </button>
        {listError && <span style={{ color: '#f87171', fontSize: 12, marginLeft: 8 }}>* {listError}</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--fx-fg-muted, #666)', fontSize: 11 }}>{PROJECT_ROOT_HINT}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: '0 0 240px', borderRight: '1px solid var(--fx-border, #2a2a2a)', overflow: 'auto', padding: 4, background: 'var(--fx-bg, #161616)' }}>
          {entries.length === 0 && (
            <div style={{ color: 'var(--fx-fg-muted, #666)', fontSize: 12, padding: 8 }}>
              {activeSlug ? '(empty directory)' : 'Enter a slug and press Enter to load the file tree.'}
            </div>
          )}
          {entries.filter((e) => e.kind === 'file').map((e) => (
            <button
              key={e.path}
              onClick={() => activeSlug && loadFile(activeSlug, e.path)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '3px 8px',
                background: activeFile === e.path ? 'var(--fx-bg-elev1, #2a2a2a)' : 'transparent',
                color: activeFile === e.path ? 'var(--fx-fg, #ddd)' : 'var(--fx-fg-muted, #aaa)',
                border: 'none',
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {e.path}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ padding: '6px 12px', background: 'var(--fx-bg-elev2, #1a1a1a)', borderBottom: '1px solid var(--fx-border, #2a2a2a)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fx-fg, #ddd)' }}>
              {activeFile ?? '(select a file on the left)'}
              {dirty && <span style={{ color: '#f59e0b', marginLeft: 6 }}>*</span>}
            </span>
            <button
              onClick={save}
              disabled={!activeFile || !dirty || savingState === 'saving'}
              style={{
                marginLeft: 'auto',
                padding: '4px 14px',
                background: dirty ? '#1a4a78' : 'var(--fx-bg-elev1, #2a2a2a)',
                color: 'var(--fx-fg, #ddd)',
                border: '1px solid var(--fx-border, #444)',
                borderRadius: 3,
                fontSize: 12,
                cursor: !activeFile || !dirty ? 'default' : 'pointer',
                opacity: !activeFile || !dirty ? 0.5 : 1,
              }}
            >
              {savingState === 'saving' ? 'Saving...' : savingState === 'saved' ? 'Saved' : 'Save (Ctrl+S)'}
            </button>
          </div>
          {fileError && (
            <div style={{ padding: '6px 12px', background: '#3a1a1a', color: '#fca5a5', fontSize: 12 }}>{fileError}</div>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                save();
              }
            }}
            disabled={!activeFile}
            style={{
              flex: 1,
              minHeight: 0,
              padding: 12,
              border: 'none',
              outline: 'none',
              background: 'var(--fx-bg, #0e0e0e)',
              color: 'var(--fx-fg, #ddd)',
              fontFamily: 'monospace',
              fontSize: 13,
              resize: 'none',
              lineHeight: 1.5,
            }}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

export default PluginAuthorPanel;

/**
 * entry.frontend mount adapter. The host calls this with a DOM node when it
 * loads the plugin via dynamic ESM (Phase 6+). Until that lands the plugin is
 * mounted by importing PluginAuthorPanel directly from this module, so this
 * adapter is unused at runtime today — kept here so the plugin schema's
 * entry.frontend points at a file with a real render() (not a thrower).
 *
 * Returns a Promise so we can lazy-load react-dom only when actually invoked
 * (avoids the cost on the direct-import path).
 */
export async function render(target: unknown): Promise<WorkbenchPanelHandle> {
  if (!target || typeof (target as { appendChild?: unknown }).appendChild !== 'function') {
    throw new Error('wb-plugin-author render(target): target must be an Element');
  }
  const ReactDOM = await import('react-dom/client');
  const root = ReactDOM.createRoot(target as Element);
  root.render(<PluginAuthorPanel />);
  return {
    unmount() { root.unmount(); },
  };
}

export function createPanel(): WorkbenchPanelHandle {
  throw new Error('wb-plugin-author: use render(target) or import PluginAuthorPanel directly');
}

export const WB_PLUGIN_AUTHOR_ID = '@forgeax-plugin/wb-plugin-author';
