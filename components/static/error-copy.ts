/**
 * Copy for the 404 and error pages (prototype 404.html, error.html). Its own module because the error boundary is
 * client code loaded with every page: it must not pull in the rest of the static pages' copy.
 */

export const NOT_FOUND_COPY = {
  title: 'Not found',
  description: 'Nothing is at this address. Check the link.',
  lede: 'Nothing at this address. Check the link.',
  /** The home page (`/`, the ask composer). */
  home: 'Ask the network',
} as const;

export const ERROR_COPY = {
  title: 'Something broke',
  h1: 'Something broke on our side',
  nothingSent: 'Nothing was sent to anyone.',
  retry: 'Try again',
  home: 'Ask the network',
} as const;

/**
 * “Ref 7F2A”: the error's digest, which Next also writes to the server log next to the error, so a reader can quote
 * it and Alan can find the line. Client-side errors have no digest: the page then shows no ref.
 */
export function errorRef(error: unknown): string | null {
  const digest = error && typeof error === 'object' && 'digest' in error ? (error as { digest?: unknown }).digest : null;
  if (typeof digest !== 'string' || !/^[0-9A-Za-z_-]{1,40}$/.test(digest)) return null;
  return digest.toUpperCase();
}
