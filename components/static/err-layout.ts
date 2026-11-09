import type { CSSProperties } from 'react';

/**
 * The 404 and error pages' three layout rules (prototype a.css `.err-head`, `.err-head .lede`, `.err-actions`), inline.
 * Why inline: a CSS file imported by app/not-found.tsx or app/error.tsx is preloaded on every page (Next ships the
 * boundaries' styles with the root layout), and Chrome then warns that the preload went unused on every page that
 * doesn't fail. Inline styles also beat `.page-head > * + *` without `!important`.
 */
export const ERR_HEAD: CSSProperties = { paddingBottom: 'var(--s10)' };
export const ERR_LEDE = { textWrap: 'balance' } as CSSProperties;
export const ERR_ACTIONS: CSSProperties = { justifyContent: 'center', marginTop: 'var(--s5)' };
