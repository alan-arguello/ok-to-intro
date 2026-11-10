/**
 * Building blocks for the email templates (ux-spec S4/S5, tech.md “Rendering”): table layout, inline CSS only,
 * system fonts, ink on white, light only (no color-scheme meta, no dark styles), no images, no tracking, no orange.
 * Buttons are bulletproof links at least 48 px tall. Pure functions; safe in client and server code (the public
 * SAMPLE email viewer renders the same templates in the browser).
 */

import type { Fact, FactLabel } from '@/lib/types';

/** Email colours: the token values from app/tokens.css, written out (email clients don't read CSS variables). */
export const EMAIL_COLOR = {
  ink: '#16140f',
  ink2: '#5f5a50',
  page: '#f5f5ee',
  card: '#ffffff',
  line: '#e0e0e0',
  hair: '#ebebeb',
  input: '#8a8575',
  mark: '#fbe9b7',
  link: '#1f6fa8',
  white: '#ffffff',
} as const;

export const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const EMAIL_MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** The viewer renders what sits between these markers (the preheader and the card), without the outer page. */
export const FRAGMENT_START = '<!--oti:email-->';
export const FRAGMENT_END = '<!--/oti:email-->';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML content and attribute values. Every value that comes from a person goes through this. */
export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** Only http(s) and mailto links reach an email; anything else becomes `#`. */
export function safeHref(url: string): string {
  const u = String(url || '').trim();
  return /^(https?:|mailto:)/i.test(u) || u.startsWith('/') ? esc(u) : '#';
}

/** Appends `key=value` to a URL that may already carry a query string. */
export function withQuery(url: string, key: string, value: string): string {
  const [base, hash] = url.split('#') as [string, string | undefined];
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash !== undefined ? `#${hash}` : ''}`;
}

/** `https://cal.com/priya-shah/20min` → `cal.com/priya-shah/20min` (how the intro shows a link). */
export function displayUrl(url: string): string {
  return String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** Card facts always read Problem, Needs, Tried, By, Offers, Price (ux-spec Revision 3). */
export const FACT_ORDER: readonly FactLabel[] = ['Problem', 'Needs', 'Tried', 'By', 'Offers', 'Price'];

export function factsInOrder(facts: readonly Fact[]): Fact[] {
  return [...facts].filter(([, v]) => v && v.trim()).sort((a, b) => FACT_ORDER.indexOf(a[0]) - FACT_ORDER.indexOf(b[0]));
}

/**
 * The first words of `text`, at most `max` characters, cut at a word boundary and ended with “…” (the offer email's
 * preheader quotes the matched rule, and inboxes show only the first 90 or so characters of a preheader).
 */
export function excerpt(text: string, max = 40): string {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.]+$/, '')}…`;
}

/* ---------- text blocks ---------- */

interface TextStyle {
  size?: number;
  line?: number;
  color?: string;
  margin?: string;
  weight?: number;
}

/** A paragraph. `html` is already-escaped markup (use `esc` for plain values). */
export function para(html: string, s: TextStyle = {}): string {
  const size = s.size ?? 15;
  const line = s.line ?? 22;
  return `<p style="margin:${s.margin ?? '0 0 14px'};font-size:${size}px;line-height:${line}px;color:${s.color ?? EMAIL_COLOR.ink}${s.weight ? `;font-weight:${s.weight}` : ''}">${html}</p>`;
}

/** The email's title: bold 20 px. */
export function heading(text: string, margin = '0'): string {
  return `<h1 style="margin:${margin};font-size:20px;line-height:26px;font-weight:600;color:${EMAIL_COLOR.ink}">${esc(text)}</h1>`;
}

/** The member's own words, highlighted like the page's `.clause` (in curly quotes). */
export function quoteMark(words: string): string {
  return `<span style="background:${EMAIL_COLOR.mark};color:${EMAIL_COLOR.ink};padding:0 2px">“${esc(words)}”</span>`;
}

export function link(label: string, href: string, color: string = EMAIL_COLOR.link): string {
  return `<a href="${safeHref(href)}" style="color:${color};text-decoration:underline">${esc(label)}</a>`;
}

/* ---------- facts table ---------- */

/** Facts as a two-column table: uppercase 11 px labels, 15 px values, hairlines between rows. */
export function factsTable(facts: readonly Fact[], pad = 9, margin = '0 0 20px'): string {
  const td1 = `width:64px;padding:${pad}px 12px ${pad}px 0;border-top:1px solid ${EMAIL_COLOR.hair};vertical-align:top;font:500 11px/22px ${EMAIL_FONT};letter-spacing:.08em;text-transform:uppercase;color:${EMAIL_COLOR.ink2}`;
  const td2 = `padding:${pad}px 0;border-top:1px solid ${EMAIL_COLOR.hair};font:15px/22px ${EMAIL_FONT};color:${EMAIL_COLOR.ink}`;
  const rows = factsInOrder(facts)
    .map(([k, v]) => `<tr><td style="${td1}">${esc(k)}</td><td style="${td2}">${esc(v)}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}">${rows}</table>`;
}

/** Plain-text facts, labels padded so the values line up (`Needs:   An intro to …`). */
export function textFacts(facts: readonly Fact[]): string[] {
  return factsInOrder(facts).map(([k, v]) => `${`${k}:`.padEnd(8, ' ')} ${v}`);
}

/* ---------- bulletproof buttons ---------- */

const BTN_WRAP = 'display:inline-block;margin:0 8px 8px 0;vertical-align:top';
const BTN_TABLE = '<table role="presentation" cellpadding="0" cellspacing="0" border="0">';

/** The one filled button (OK to intro, Answer it): ink with a white label, 48 px (14 + 20 + 14). */
export function inkButton(label: string, href: string): string {
  return `<div style="${BTN_WRAP}">${BTN_TABLE}<tr><td bgcolor="${EMAIL_COLOR.ink}" style="border-radius:999px"><a href="${safeHref(href)}" style="display:inline-block;padding:14px 24px;font:500 16px/20px ${EMAIL_FONT};color:${EMAIL_COLOR.white};text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table></div>`;
}

/** An outlined pill: 48 px (1 + 13 + 20 + 13 + 1). */
export function outlineButton(label: string, href: string): string {
  return `<div style="${BTN_WRAP}">${BTN_TABLE}<tr><td style="border:1px solid ${EMAIL_COLOR.input};border-radius:999px"><a href="${safeHref(href)}" style="display:inline-block;padding:13px 22px;font:500 16px/20px ${EMAIL_FONT};color:${EMAIL_COLOR.ink};text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table></div>`;
}

/** A 48 px square for the 1–5 scale. */
export function squareButton(label: string, href: string): string {
  return `<div style="${BTN_WRAP}">${BTN_TABLE}<tr><td style="border:1px solid ${EMAIL_COLOR.input};border-radius:8px"><a href="${safeHref(href)}" style="display:inline-block;width:46px;text-align:center;font:500 18px/46px ${EMAIL_FONT};color:${EMAIL_COLOR.ink};text-decoration:none;border-radius:8px">${esc(label)}</a></td></tr></table></div>`;
}

/* ---------- the card ---------- */

/** One row of the card: a padded cell in the system font. */
export function cardRow(html: string, padding: string): string {
  return `<tr><td style="padding:${padding};font-family:${EMAIL_FONT};color:${EMAIL_COLOR.ink}">${html}</td></tr>`;
}

/** The footer row: hairline on top, 13 px links, then the disclaimer. */
export function footerRow(html: string): string {
  return `<tr><td style="padding:16px 24px 24px;border-top:1px solid ${EMAIL_COLOR.hair};font-family:${EMAIL_FONT}">${html}</td></tr>`;
}

export function footerLinks(links: readonly { label: string; href: string }[]): string {
  return para(links.map((l) => link(l.label, l.href)).join(' · '), { size: 13, line: 20, color: EMAIL_COLOR.ink2, margin: '0 0 6px' });
}

export function footerNote(html: string): string {
  return para(html, { size: 13, line: 20, color: EMAIL_COLOR.ink2, margin: '0' });
}

/** The 560 px white card. */
export function card(rows: readonly string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto;background:${EMAIL_COLOR.card};border:1px solid ${EMAIL_COLOR.line};border-radius:8px">${rows.join('')}</table>`;
}

/** Hidden preview text (shown by inbox lists, never in the body). */
export function preheaderHtml(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${EMAIL_COLOR.white}">${esc(text)}</div>`;
}

/**
 * The whole document: no color-scheme meta (Apple Mail half-inverts when it is present without dark styles),
 * a beige page around the 560 px card, and the fragment markers the SAMPLE viewer reads.
 */
export function emailDocument(title: string, preheader: string, cardHtml: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="x-apple-disable-message-reformatting"><title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${EMAIL_COLOR.page}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${EMAIL_COLOR.page}"><tr><td style="padding:16px 8px">` +
    `${FRAGMENT_START}${preheaderHtml(preheader)}${cardHtml}${FRAGMENT_END}` +
    '</td></tr></table></body></html>'
  );
}

/** The preheader and card of a rendered email (what the SAMPLE viewer shows), or the whole html if unmarked. */
export function emailFragment(html: string): string {
  const a = html.indexOf(FRAGMENT_START);
  const b = html.indexOf(FRAGMENT_END);
  return a >= 0 && b > a ? html.slice(a + FRAGMENT_START.length, b) : html;
}
