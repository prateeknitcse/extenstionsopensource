import type { Category, Font, Level } from './fonts';
import { CATEGORIES, isCategory, isLevel } from './fonts';
import { pickDaily, toISODate } from './pick';

export type OverrideMode = 'tab' | 'site' | 'global';
export type FontSource = OverrideMode | 'daily' | 'pinned';
export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** A saved override. `site` and `global` expire at local midnight. */
export interface StoredOverride {
  fontId: string;
  mode: OverrideMode;
  /** Epoch ms at which the override stops applying. */
  expiresAt: number;
}

export interface OverrideStore {
  global: StoredOverride | null;
  /** Keyed by normalized hostname. */
  sites: Record<string, StoredOverride>;
}

export interface Settings {
  enabled: boolean;
  level: Level;
  categories: Category[];
  dyslexiaSafe: boolean;
  includeInputs: boolean;
  alwaysShowName: boolean;
  listMode: 'blocklist' | 'allowlist';
  blocklist: string[];
  allowlist: string[];
  pinnedSites: Record<string, string>;
  pageTheme: ThemeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  level: 2,
  categories: [...CATEGORIES],
  dyslexiaSafe: false,
  includeInputs: false,
  alwaysShowName: false,
  listMode: 'blocklist',
  blocklist: [],
  allowlist: [],
  pinnedSites: {},
  pageTheme: 'system',
};

// ---------- time ----------

/** Epoch ms of the next local midnight strictly after `now`. */
export function nextMidnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

export function isExpired(override: StoredOverride, now: number): boolean {
  return now >= override.expiresAt;
}

export function createOverride(fontId: string, mode: OverrideMode, now: number): StoredOverride {
  return { fontId, mode, expiresAt: nextMidnight(now) };
}

/** Drop expired overrides. Returns the same object when nothing changed. */
export function pruneOverrides(store: OverrideStore, now: number): OverrideStore {
  const global = store.global && !isExpired(store.global, now) ? store.global : null;
  const sites: Record<string, StoredOverride> = {};
  for (const [host, o] of Object.entries(store.sites)) {
    if (!isExpired(o, now)) sites[host] = o;
  }
  const unchanged =
    global === store.global && Object.keys(sites).length === Object.keys(store.sites).length;
  return unchanged ? store : { global, sites };
}

// ---------- resolution ----------

export interface ResolveInput {
  dailyId: string;
  /** In-memory tab override from the background script. */
  tab?: string | null;
  site?: StoredOverride | null;
  global?: StoredOverride | null;
  /** Per-site pinned font from settings. */
  pinned?: string | null;
  now: number;
  /** Ignore overrides whose font no longer exists. */
  isKnown?: (fontId: string) => boolean;
}

export interface Resolution {
  fontId: string;
  source: FontSource;
}

/** Resolution order: tab > site > global > pinned > daily. Expired or unknown overrides are skipped. */
export function resolveFont(input: ResolveInput): Resolution {
  const known = input.isKnown ?? (() => true);
  if (input.tab && known(input.tab)) return { fontId: input.tab, source: 'tab' };
  for (const [override, source] of [
    [input.site, 'site'],
    [input.global, 'global'],
  ] as const) {
    if (override && !isExpired(override, input.now) && known(override.fontId)) {
      return { fontId: override.fontId, source };
    }
  }
  if (input.pinned && known(input.pinned)) {
    return { fontId: input.pinned, source: 'pinned' };
  }
  return { fontId: input.dailyId, source: 'daily' };
}

export function sourceLabel(source: FontSource): string {
  switch (source) {
    case 'tab':
      return 'Random (this tab)';
    case 'site':
      return 'Random (this site)';
    case 'global':
      return 'Random (everywhere, until midnight)';
    case 'pinned':
      return 'Pinned to this site';
    default:
      return "Today's pick";
  }
}

/** Today's font for these settings. Never affected by Random overrides. */
export function dailyFont(fonts: readonly Font[], settings: Settings, now: number): Font {
  return pickDaily(toISODate(new Date(now)), settings.level, fonts, {
    categories: settings.categories,
    dyslexiaSafe: settings.dyslexiaSafe,
  });
}

// ---------- sites ----------

/** Lowercase host without a leading "www.". */
export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

export function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? normalizeHost(u.hostname) : null;
  } catch {
    return null;
  }
}

function listMatches(list: readonly string[], host: string): boolean {
  const h = normalizeHost(host);
  return list.some((entry) => {
    const e = normalizeHost(entry);
    return e !== '' && (h === e || h.endsWith(`.${e}`));
  });
}

/** Whether Cursed Fonts should run on this host under the current list mode. */
export function isSiteEnabled(settings: Settings, host: string): boolean {
  if (!settings.enabled) return false;
  return settings.listMode === 'allowlist'
    ? listMatches(settings.allowlist, host)
    : !listMatches(settings.blocklist, host);
}

/** Flip the per-site toggle by editing the active list. Returns new settings. */
export function toggleSite(settings: Settings, host: string): Settings {
  const h = normalizeHost(host);
  const key = settings.listMode === 'allowlist' ? 'allowlist' : 'blocklist';
  const list = settings[key];
  const present = list.some((e) => normalizeHost(e) === h);
  const next = present ? list.filter((e) => normalizeHost(e) !== h) : [...list, h];
  return { ...settings, [key]: next };
}

/** Pin a font to a hostname so it persists indefinitely. Returns new settings. */
export function pinFont(settings: Settings, host: string, fontId: string): Settings {
  const h = normalizeHost(host);
  return {
    ...settings,
    pinnedSites: {
      ...settings.pinnedSites,
      [h]: fontId,
    },
  };
}

/** Unpin a font from a hostname. Returns new settings. */
export function unpinFont(settings: Settings, host: string): Settings {
  const h = normalizeHost(host);
  const next = { ...settings.pinnedSites };
  delete next[h];
  return {
    ...settings,
    pinnedSites: next,
  };
}

// ---------- settings validation ----------

function cleanHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = value
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeHost)
    .filter((v) => v !== '');
  return [...new Set(hosts)];
}

function cleanPinnedSites(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && v.trim() !== '') {
      const host = normalizeHost(k);
      if (host) out[host] = v.trim();
    }
  }
  return out;
}

/** Coerce untrusted data (storage, imported JSON) into valid Settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof Settings, fallback: boolean): boolean =>
    typeof r[key] === 'boolean' ? (r[key] as boolean) : fallback;
  const categories = Array.isArray(r.categories) ? r.categories.filter(isCategory) : [];
  return {
    enabled: bool('enabled', DEFAULT_SETTINGS.enabled),
    level: isLevel(r.level) ? r.level : DEFAULT_SETTINGS.level,
    categories: categories.length > 0 ? [...new Set(categories)] : [...DEFAULT_SETTINGS.categories],
    dyslexiaSafe: bool('dyslexiaSafe', DEFAULT_SETTINGS.dyslexiaSafe),
    includeInputs: bool('includeInputs', DEFAULT_SETTINGS.includeInputs),
    alwaysShowName: bool('alwaysShowName', DEFAULT_SETTINGS.alwaysShowName),
    listMode: r.listMode === 'allowlist' ? 'allowlist' : 'blocklist',
    blocklist: cleanHosts(r.blocklist),
    allowlist: cleanHosts(r.allowlist),
    pinnedSites: cleanPinnedSites(r.pinnedSites),
    pageTheme: isThemeMode(r.pageTheme) ? r.pageTheme : DEFAULT_SETTINGS.pageTheme,
  };
}
