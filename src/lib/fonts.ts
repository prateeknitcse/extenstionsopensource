import fontsJson from '../fonts/fonts.json';

export const CATEGORIES = [
  'serif',
  'sans',
  'mono',
  'display',
  'handwriting',
  'blackletter',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];

export interface Font {
  id: string;
  name: string;
  category: Category;
  cursedLevel: Level;
  dyslexiaSafe: boolean;
  designer: string;
  year: number;
  fact: string;
  license: string;
  file: string;
}

export interface FontFilter {
  categories?: readonly Category[];
  dyslexiaSafe?: boolean;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return value === 1 || value === 2 || value === 3;
}

export function isFont(value: unknown): value is Font {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === 'string' &&
    typeof f.name === 'string' &&
    isCategory(f.category) &&
    isLevel(f.cursedLevel) &&
    typeof f.dyslexiaSafe === 'boolean' &&
    typeof f.designer === 'string' &&
    typeof f.year === 'number' &&
    typeof f.fact === 'string' &&
    typeof f.license === 'string' &&
    typeof f.file === 'string'
  );
}

/** Validate raw JSON into a font list. Throws on the first malformed entry. */
export function parseFonts(raw: unknown): Font[] {
  if (!Array.isArray(raw)) throw new Error('fonts.json must be an array');
  return raw.map((entry, i) => {
    if (!isFont(entry)) throw new Error(`fonts.json entry ${i} is malformed`);
    return entry;
  });
}

/** All bundled fonts, validated once at load. */
export const ALL_FONTS: readonly Font[] = parseFonts(fontsJson);

export function getFontById(id: string, fonts: readonly Font[] = ALL_FONTS): Font | undefined {
  return fonts.find((f) => f.id === id);
}

export function isMonospace(font: Font): boolean {
  return font.category === 'mono';
}

/** Strict filter by category and dyslexia-safe mode. Level is handled separately. */
export function filterFonts(fonts: readonly Font[], filter: FontFilter = {}): Font[] {
  const { categories, dyslexiaSafe } = filter;
  return fonts.filter(
    (f) =>
      (!dyslexiaSafe || f.dyslexiaSafe) &&
      (!categories || categories.length === 0 || categories.includes(f.category)),
  );
}

/** Keep fonts whose cursed level is at most `level`. */
export function filterByLevel(fonts: readonly Font[], level: Level): Font[] {
  return fonts.filter((f) => f.cursedLevel <= level);
}

/**
 * Category + dyslexia-safe filter that never returns an empty list for a
 * non-empty input: it drops the category filter first, then the dyslexia filter.
 */
export function eligibleFonts(fonts: readonly Font[], filter: FontFilter = {}): Font[] {
  const strict = filterFonts(fonts, filter);
  if (strict.length > 0) return strict;
  const noCategory = filterFonts(fonts, { dyslexiaSafe: filter.dyslexiaSafe });
  if (noCategory.length > 0) return noCategory;
  return [...fonts];
}

/** CSS family name registered for a font. */
export function familyName(font: Font): string {
  return `CursedFont-${font.id}`;
}

/** Generic fallback used after the custom family. */
export function genericFallback(font: Font): string {
  switch (font.category) {
    case 'serif':
    case 'blackletter':
      return 'serif';
    case 'mono':
      return 'monospace';
    case 'handwriting':
      return 'cursive';
    default:
      return 'sans-serif';
  }
}

const ICON_FONT_PATTERN =
  /icon|awesome|material|glyphicon|fontello|symbols|dashicons|codicon|themify|feather|remix|lucide|ionicons|linearicons|elusive|typicons|foundation-icons/i;

/** True when a computed font-family value belongs to an icon font. */
export function isIconFontFamily(computedFamily: string): boolean {
  return ICON_FONT_PATTERN.test(computedFamily);
}

/** Selector for elements that might use an icon font. Cheap to query. */
export const ICON_CANDIDATE_SELECTOR = [
  'i',
  '[class*="icon" i]',
  '[class*="fa-"]',
  '[class*="fa "]',
  '[class^="fa"]',
  '[class*="material" i]',
  '[class*="glyph" i]',
  '[class*="symbol" i]',
  '[class*="fontello" i]',
  '[class*="ion-"]',
  '[class*="bi-"]',
  '[class*="codicon"]',
  '[data-icon]',
].join(',');

const TEXT_ELEMENTS = [
  'html',
  'body',
  'p',
  'span',
  'a',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'td',
  'th',
  'caption',
  'label',
  'legend',
  'button',
  'blockquote',
  'figcaption',
  'summary',
  'em',
  'strong',
  'b',
  'i',
  'small',
  'sub',
  'sup',
  'mark',
  'cite',
  'q',
  'abbr',
  'time',
  'address',
];
const CODE_ELEMENTS = ['code', 'pre', 'kbd', 'samp'];
const FORM_ELEMENTS = ['input', 'textarea', 'select', 'option'];
export const EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
export const SKIP_ATTRIBUTE = 'data-cf-skip';

export interface CssOptions {
  includeInputs: boolean;
  pageTheme?: 'system' | 'light' | 'dark';
}

/** Build the override stylesheet for a font. Pure, so it is easy to test. */
export function buildCss(font: Font, options: CssOptions): string {
  const mono = isMonospace(font);
  const elements = [...TEXT_ELEMENTS];
  if (mono) elements.push(...CODE_ELEMENTS);
  if (options.includeInputs) elements.push(...FORM_ELEMENTS);

  const excluded = [`[${SKIP_ATTRIBUTE}]`, `[${SKIP_ATTRIBUTE}] *`];
  if (!mono) excluded.push(...CODE_ELEMENTS.flatMap((tag) => [tag, `${tag} *`]));
  if (!options.includeInputs) {
    excluded.push(
      `${EDITABLE_SELECTOR.split(', ').join(' *, ')} *`,
      ...EDITABLE_SELECTOR.split(', '),
    );
  }
  const notClause = `:not(${excluded.join(', ')})`;
  const selector = elements.map((el) => `${el}${notClause}`).join(',\n');
  const family = `"${familyName(font)}", ${genericFallback(font)}`;

  let themeBlock = '';
  if (options.pageTheme === 'dark') {
    themeBlock = 'html, :root {\n  color-scheme: dark !important;\n}\n';
  } else if (options.pageTheme === 'light') {
    themeBlock = 'html, :root {\n  color-scheme: light !important;\n}\n';
  }

  return `${themeBlock}${selector} {\n  font-family: ${family} !important;\n}\n`;
}
