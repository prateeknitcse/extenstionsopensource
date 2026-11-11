import { browser } from 'wxt/browser';
import { loadFont, unloadFont } from '@/lib/fontface';
import {
  ALL_FONTS,
  ICON_CANDIDATE_SELECTOR,
  SKIP_ATTRIBUTE,
  buildCss,
  getFontById,
  isIconFontFamily,
} from '@/lib/fonts';
import type { Font } from '@/lib/fonts';
import { dailyFont, isSiteEnabled, normalizeHost, resolveFont } from '@/lib/state';
import type { ThemeMode } from '@/lib/state';
import { getSettings, readLocal, sendMessage } from '@/lib/storage';
import type { Message, TabOverrideReply } from '@/lib/storage';

const MUTATION_DEBOUNCE_MS = 50;
const STORAGE_DEBOUNCE_MS = 100;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main() {
    const host = normalizeHost(location.hostname);

    let sheet: CSSStyleSheet | null = null;
    let styleEl: HTMLStyleElement | null = null;
    let observer: MutationObserver | null = null;
    let active: Font | null = null;
    let appliedInputs = false;
    let appliedPageTheme: ThemeMode = 'system';
    let generation = 0;
    let siteEnabled = false;
    let includeInputs = false;

    const pending = new Set<Element>();
    let flushTimer: number | undefined;

    function debounce(fn: () => void, ms: number): () => void {
      let timer: number | undefined;
      return () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(fn, ms);
      };
    }

    // ---------- stylesheet ----------

    function setCss(css: string): void {
      try {
        if (!sheet) {
          const created = new CSSStyleSheet();
          created.replaceSync(css);
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, created];
          sheet = created;
        } else {
          sheet.replaceSync(css);
        }
        styleEl?.remove();
        styleEl = null;
        return;
      } catch {
        sheet = null; // constructable stylesheets unavailable: use <style>
      }
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.setAttribute('data-cursed-fonts', '');
        (document.head ?? document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = css;
    }

    function clearCss(): void {
      if (sheet) {
        const current = sheet;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== current);
        sheet = null;
      }
      styleEl?.remove();
      styleEl = null;
    }

    // ---------- icon-font protection ----------

    function usesIconFont(el: Element): boolean {
      // The element is marked with SKIP_ATTRIBUTE while this runs, so these are
      // the page's own computed values, not ours.
      return [undefined, '::before', '::after'].some((pseudo) =>
        isIconFontFamily(getComputedStyle(el, pseudo).fontFamily),
      );
    }

    function mark(el: Element): void {
      if (el.hasAttribute(SKIP_ATTRIBUTE)) return;
      el.setAttribute(SKIP_ATTRIBUTE, '');
      pending.add(el);
    }

    function collect(root: Element): void {
      if (root.matches(ICON_CANDIDATE_SELECTOR)) mark(root);
      root.querySelectorAll(ICON_CANDIDATE_SELECTOR).forEach(mark);
    }

    /** Batched: all attribute writes happen first, then all style reads, then writes. */
    function flush(): void {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
      if (pending.size === 0) return;
      const elements = [...pending];
      pending.clear();
      const verdicts = elements.map(usesIconFont);
      elements.forEach((el, i) => {
        if (!verdicts[i]) el.removeAttribute(SKIP_ATTRIBUTE);
      });
    }

    function scheduleFlush(): void {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, MUTATION_DEBOUNCE_MS);
    }

    function startObserver(): void {
      if (observer) return;
      observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) collect(node);
          });
        }
        if (pending.size > 0) scheduleFlush();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopObserver(): void {
      observer?.disconnect();
      observer = null;
      window.clearTimeout(flushTimer);
      pending.clear();
    }

    // ---------- apply / clear ----------

    function clearAll(): void {
      generation++;
      stopObserver();
      clearCss();
      if (active) unloadFont(active);
      active = null;
      appliedPageTheme = 'system';
    }

    /** Preload the font, then swap the rules. Failure keeps the page's own font. */
    async function apply(font: Font, pageTheme: ThemeMode = 'system'): Promise<void> {
      if (
        active?.id === font.id &&
        appliedInputs === includeInputs &&
        appliedPageTheme === pageTheme
      ) {
        return;
      }
      const gen = ++generation;
      const face = await loadFont(font);
      if (gen !== generation) return; // a newer request superseded this one
      if (!face) return; // silent fallback to the page's original font
      setCss(buildCss(font, { includeInputs, pageTheme }));
      const previous = active;
      active = font;
      appliedInputs = includeInputs;
      appliedPageTheme = pageTheme;
      if (previous && previous.id !== font.id) unloadFont(previous);
      startObserver();
      collect(document.documentElement);
      flush();
    }

    // ---------- resolution (tab > site > global > daily) ----------

    async function refresh(): Promise<void> {
      try {
        const [settings, overrides, tab] = await Promise.all([
          getSettings(),
          readLocal('overrides'),
          sendMessage<TabOverrideReply>({ type: 'GET_TAB_OVERRIDE' }).catch(
            (): TabOverrideReply => ({ fontId: null }),
          ),
        ]);
        siteEnabled = isSiteEnabled(settings, host);
        includeInputs = settings.includeInputs;
        if (!siteEnabled) {
          clearAll();
          return;
        }
        const now = Date.now();
        const daily = dailyFont(ALL_FONTS, settings, now);
        const { fontId } = resolveFont({
          dailyId: daily.id,
          tab: tab?.fontId ?? null,
          site: overrides.sites[host] ?? null,
          global: overrides.global,
          pinned: settings.pinnedSites[host] ?? null,
          now,
          isKnown: (id) => getFontById(id) !== undefined,
        });
        await apply(getFontById(fontId) ?? daily, settings.pageTheme);
      } catch {
        // Extension context invalidated or storage unavailable: leave the page alone.
      }
    }

    // ---------- events ----------

    function isMessage(value: unknown): value is Message {
      return typeof value === 'object' && value !== null && 'type' in value;
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isMessage(message)) return undefined;
      if (message.type === 'SET_FONT') {
        const font = getFontById(message.fontId);
        if (font && siteEnabled) void apply(font);
      } else if (message.type === 'REFRESH') {
        void refresh();
      }
      return undefined;
    });

    const refreshSoon = debounce(() => void refresh(), STORAGE_DEBOUNCE_MS);
    browser.storage.onChanged.addListener((changes, area) => {
      if ((area === 'sync' && changes.settings) || (area === 'local' && changes.overrides)) {
        refreshSoon();
      }
    });

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) void refresh();
    });

    void refresh();
  },
});
