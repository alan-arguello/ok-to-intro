/**
 * Site constants. Every absolute URL, and every piece of copy that shows the host, reads from here.
 * The production domain is not decided yet: set NEXT_PUBLIC_SITE_URL and everything follows
 * (install commands, MCP URL, email links, receipts, OG tags, the contact address).
 *
 * Safe in client and server code: it reads only NEXT_PUBLIC_SITE_URL, which Next inlines at build time.
 */

const FALLBACK_URL = 'http://localhost:3200';

function normalizeSiteUrl(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return FALLBACK_URL;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return FALLBACK_URL;
  }
}

/**
 * Origin of the deployed site, without a trailing slash, e.g. `https://ok-to-intro.vercel.app`.
 * NEXT_PUBLIC_SITE_URL wins; on Vercel without it, the project's production domain (a system variable Vercel
 * exposes to Next.js builds); locally, http://localhost:3200.
 */
export const SITE_URL: string = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL);

/** Host shown in copy, e.g. `ok-to-intro.vercel.app` (port kept for localhost). */
export const SITE_HOST: string = new URL(SITE_URL).host;

/** True when the site runs on a real product domain (not localhost or a *.vercel.app preview). */
export const IS_PRODUCT_DOMAIN: boolean = !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(SITE_HOST) && !/\.vercel\.app$/.test(SITE_HOST);

/** The apex used for mailboxes: `www.` is dropped. */
const MAIL_DOMAIN = SITE_HOST.replace(/^www\./, '').replace(/:\d+$/, '');

export const PRODUCT_NAME = 'OK to Intro';
export const AUTHOR_NAME = 'Alan Arguello';

/**
 * Model ids (spec §7). Gates run on Haiku, the compiler on Sonnet; Opus only offline (drafting sample members
 * and eval candidates that humans label). Shown in copy, so they live here.
 */
export const MODELS = {
  gate: 'claude-haiku-5-5',
  compiler: 'claude-sonnet-5-5',
  offline: 'claude-opus-5-5',
} as const;

/** The one place the product mentions Y Combinator (ux-spec §3, footer). */
export const DISCLAIMER = 'Independent project, not affiliated with Y Combinator.';
export const FOOTER_LINE = `${DISCLAIMER} Built by ${AUTHOR_NAME}.`;

export const REPO_SLUG = 'alan-arguello/ok-to-intro';
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
/** Shown as text: "github.com/alan-arguello/ok-to-intro". */
export const REPO_DISPLAY = `github.com/${REPO_SLUG}`;

/** MCP server id, plugin name and marketplace name are the same everywhere (ux-spec S6). */
export const MCP_SERVER_ID = 'ok-to-intro';
export const PLUGIN_NAME = 'ok-to-intro';
export const MCP_PATH = '/mcp';
export const MCP_URL = `${SITE_URL}${MCP_PATH}`;

/** The two install commands on /agents, the playground and the README. */
export const INSTALL_PLUGIN_COMMAND = `claude plugin install ${PLUGIN_NAME} --marketplace ${REPO_SLUG}`;
export const INSTALL_MCP_COMMAND = `claude mcp add --transport http --scope user ${MCP_SERVER_ID} ${MCP_URL}`;
/** The older two-step plugin install, for reference text. */
export const INSTALL_PLUGIN_TWO_STEP = [
  `claude plugin marketplace add ${REPO_SLUG}`,
  `claude plugin install ${PLUGIN_NAME}@${PLUGIN_NAME}`,
] as const;
export const PLUGIN_CONFIGURE_COMMAND = `claude plugin configure ${PLUGIN_NAME}`;

function validEmail(raw: string | undefined): string | null {
  const v = (raw || '').trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(v) ? v : null;
}

/**
 * Contact address for /privacy and footers (ux-spec S8). NEXT_PUBLIC_CONTACT_EMAIL wins (e.g. an address on the
 * domain mail is sent from, when the site itself runs on *.vercel.app); otherwise `alan@<product domain>` once the
 * site runs on a product domain; otherwise `null`, and pages link to the repo's issues instead. Never a placeholder.
 */
export const CONTACT_EMAIL: string | null = validEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL) ?? (IS_PRODUCT_DOMAIN ? `alan@${MAIL_DOMAIN}` : null);
export const CONTACT_FALLBACK_URL = `${REPO_URL}/issues`;

/** Absolute URL for a path on this site. `absoluteUrl('/o/abc')` → `https://ok-to-intro.vercel.app/o/abc`. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Public routes, so links are typed once. */
export const ROUTES = {
  home: '/',
  ask: '/ask',
  /** The member's side: the rules playground (it was `/` until the ask-first home). */
  rules: '/rules',
  askStatus: (id: string) => `/ask/${encodeURIComponent(id)}`,
  board: '/board',
  agents: '/agents',
  how: '/how',
  privacy: '/privacy',
  join: '/join',
  me: '/me',
  offer: (token: string) => `/o/${encodeURIComponent(token)}`,
  checkin: (token: string) => `/c/${encodeURIComponent(token)}`,
  pause: (token: string) => `/pause/${encodeURIComponent(token)}`,
  sampleEmail: (kind: string) => `/emails/${encodeURIComponent(kind)}`,
  kit: '/kit',
} as const;

/**
 * Header nav (desktop) and the phone menu (which adds "Sign in" last). “Ask” is the home page (the composer; it is
 * also current on /ask and /ask/<id>); “Be asked” is the rules playground.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'Ask' },
  { href: '/rules', label: 'Be asked' },
  { href: '/board', label: 'Board' },
  { href: '/agents', label: 'Agents' },
  { href: '/how', label: 'How it works' },
] as const;

export const FOOTER_LINKS = [
  { href: '/board', label: 'Board', external: false },
  { href: '/privacy', label: 'Privacy', external: false },
  { href: REPO_URL, label: 'Code (MIT)', external: true },
] as const;

export const DEFAULT_DESCRIPTION =
  'Write what you’d agree to be asked and a monthly cap. A small model checks each ask against your words and must quote the line it used.';
