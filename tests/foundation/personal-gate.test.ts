import { describe, expect, it } from 'vitest';
import { capVerdict, isValidSlug, slugify } from '@/lib/oti/personal-gate';
import { hashOwnerToken, newOwnerToken, ownerTokenMatches } from '@/lib/server/gate-token';

describe('personal gates: pure parts', () => {
  it('owner token: 32 random bytes as base64url, stored as SHA-256 hex, compared in constant time', () => {
    const t = newOwnerToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOwnerToken()).not.toBe(t);
    const h = hashOwnerToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerTokenMatches(t, h)).toBe(true);
    expect(ownerTokenMatches(`${t}x`, h)).toBe(false);
    expect(ownerTokenMatches('', h)).toBe(false);
    expect(ownerTokenMatches(null, h)).toBe(false);
    expect(ownerTokenMatches(t, 'not-a-hash')).toBe(false);
  });

  it('slug normalisation', () => {
    expect(slugify('Alan Argüello')).toBe('alan-arguello');
    expect(slugify('  --María José!! ')).toBe('maria-jose');
    expect(slugify('a'.repeat(50))).toHaveLength(40);
    expect(isValidSlug(slugify('Alan Argüello'))).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('Has Caps')).toBe(false);
  });

  it('monthly cap turns an accept at or past the cap into over_cap, nothing else', () => {
    expect(capVerdict('accept', 0, 2)).toBe('accept');
    expect(capVerdict('accept', 1, 2)).toBe('accept');
    expect(capVerdict('accept', 2, 2)).toBe('over_cap');
    expect(capVerdict('decline', 5, 2)).toBe('decline');
    expect(capVerdict('ask_back', 5, 2)).toBe('ask_back');
  });
});
