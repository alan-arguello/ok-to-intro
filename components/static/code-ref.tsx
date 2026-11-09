import { REPO_URL } from '@/lib/site';

/**
 * A link to the file in the public repo that enforces a line of copy (/privacy). `HEAD` resolves to the default
 * branch, whatever it is called. Every path used is checked to exist in the working tree (tests/site and
 * scripts/check-links.mjs), so the page never links to code that isn't there.
 */
export function codeUrl(path: string): string {
  return `${REPO_URL}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function CodeRefs({ paths, label = 'Code' }: { paths: readonly string[]; label?: string }) {
  return (
    <p className="meta priv-code">
      {label}:{' '}
      {paths.map((p, i) => (
        <span key={p}>
          {i ? ' · ' : null}
          <a className="link" href={codeUrl(p)} rel="noopener">
            {p}
          </a>
        </span>
      ))}
    </p>
  );
}
