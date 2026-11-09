/** Joins class names, skipping falsy values: cx('btn', primary && 'btn--primary'). */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}
