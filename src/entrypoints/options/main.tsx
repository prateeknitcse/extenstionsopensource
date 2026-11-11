import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES } from '@/lib/fonts';
import type { Category } from '@/lib/fonts';
import { DEFAULT_SETTINGS, sanitizeSettings, unpinFont } from '@/lib/state';
import type { Settings } from '@/lib/state';
import { getSettings, setSettings } from '@/lib/storage';
import './style.css';

const LEVELS = [
  { value: 1, label: '1 - Tasteful' },
  { value: 2, label: '2 - Quirky' },
  { value: 3, label: '3 - Unhinged' },
] as const;

function toLines(hosts: string[]): string {
  return hosts.join('\n');
}

function fromLines(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

function Options() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [listText, setListText] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const show = useCallback((s: Settings) => {
    setLocal(s);
    setListText(toLines(s.listMode === 'allowlist' ? s.allowlist : s.blocklist));
  }, []);

  useEffect(() => {
    let live = true;
    void getSettings().then((s) => {
      if (live) show(s);
    });
    return () => {
      live = false;
    };
  }, [show]);

  if (!settings) return <main>Loading…</main>;

  const save = async (change: Partial<Settings>, note = 'Saved.') => {
    const next = sanitizeSettings({ ...settings, ...change });
    await setSettings(next);
    setLocal(next);
    setMessage(note);
  };

  const toggleCategory = (category: Category, on: boolean) => {
    const next = on
      ? [...settings.categories, category]
      : settings.categories.filter((c) => c !== category);
    // An empty selection means "all", so keep at least one checked.
    if (next.length > 0) void save({ categories: next });
  };

  const listKey = settings.listMode === 'allowlist' ? 'allowlist' : 'blocklist';

  const switchMode = async (mode: Settings['listMode']) => {
    const next = sanitizeSettings({ ...settings, listMode: mode });
    await setSettings(next);
    setLocal(next);
    setListText(toLines(mode === 'allowlist' ? next.allowlist : next.blocklist));
    setMessage('Saved.');
  };

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cursed-fonts-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = async (file: File) => {
    try {
      const imported = sanitizeSettings(JSON.parse(await file.text()));
      await setSettings(imported);
      show(imported);
      setMessage('Imported.');
    } catch {
      setMessage('That file is not valid settings JSON.');
    }
  };

  return (
    <main>
      <header className="options-header">
        <h1>Cursed Fonts Settings</h1>
        <p className="header-subtitle">Preferences and per-site font overrides</p>
      </header>

      <section>
        <h2>Cursed level</h2>
        <select
          value={settings.level}
          onChange={(e) => void save({ level: Number(e.target.value) as Settings['level'] })}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="hint">A level includes every font at that level or below.</p>
      </section>

      <section>
        <h2>Categories</h2>
        <div className="grid">
          {CATEGORIES.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={settings.categories.includes(c)}
                onChange={(e) => toggleCategory(c, e.target.checked)}
              />
              {c}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Behavior</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.dyslexiaSafe}
            onChange={(e) => void save({ dyslexiaSafe: e.target.checked })}
          />
          Dyslexia-safe mode (daily pick and Random use only dyslexia-friendly fonts)
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.includeInputs}
            onChange={(e) => void save({ includeInputs: e.target.checked })}
          />
          Apply fonts to inputs, textareas and editable areas
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.alwaysShowName}
            onChange={(e) => void save({ alwaysShowName: e.target.checked })}
          />
          Always show font name (skips the quiz)
        </label>
      </section>

      <section>
        <h2>Website theme</h2>
        <p className="hint">
          Override the color scheme of websites you visit, or follow system defaults.
        </p>
        <div className="grid">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="pageTheme"
                checked={settings.pageTheme === mode}
                onChange={() => void save({ pageTheme: mode })}
              />
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Sites</h2>
        <label>
          <input
            type="radio"
            name="mode"
            checked={settings.listMode === 'blocklist'}
            onChange={() => void switchMode('blocklist')}
          />
          Everywhere except the blocklist
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={settings.listMode === 'allowlist'}
            onChange={() => void switchMode('allowlist')}
          />
          Only on the allowlist
        </label>
        <textarea
          rows={6}
          aria-label={`${listKey} hostnames`}
          placeholder="One hostname per line, e.g. example.com (subdomains match too)"
          value={listText}
          onChange={(e) => setListText(e.target.value)}
        />
        <button onClick={() => void save({ [listKey]: fromLines(listText) })}>
          Save {listKey}
        </button>
      </section>

      {Object.keys(settings.pinnedSites).length > 0 && (
        <section>
          <h2>Pinned sites</h2>
          <p className="hint">Fonts pinned to a site never change and do not expire at midnight.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(settings.pinnedSites).map(([host, fontId]) => (
              <div key={host} className="pinned-item">
                <span>
                  <strong>{host}</strong>: {fontId}
                </span>
                <button onClick={() => void save(unpinFont(settings, host))}>Unpin</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Backup</h2>
        <div className="buttons">
          <button onClick={exportSettings}>Export settings</button>
          <button onClick={() => fileInput.current?.click()}>Import settings</button>
          <button onClick={() => void save({ ...DEFAULT_SETTINGS }, 'Reset to defaults.')}>
            Reset
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importSettings(file);
            e.target.value = '';
          }}
        />
      </section>

      <p role="status" className="hint">
        {message}
      </p>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
}
