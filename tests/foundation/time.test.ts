import { describe, expect, it } from 'vitest';
import { askerAsOf, capMonth, fmtClock, fmtDay, fmtWhen, hoursLeft, lastCheckpoint, monthName, nextCheckpoint, nextMonthStart, NETWORK_TZ, resetsOn, zonedTimeToUtc } from '@/lib/oti/time';

const iso = (d: Date) => d.toISOString();

describe('formatting in a zone', () => {
  it('renders the REAL example exactly as the spec prints it', () => {
    const replyBy = Date.parse('2026-11-12T21:04:00-06:00');
    expect(fmtWhen(replyBy, NETWORK_TZ)).toBe('Thu Nov 12, 21:04 CST');
    expect(fmtDay(replyBy, NETWORK_TZ)).toBe('Nov 12');
    expect(fmtClock(replyBy, NETWORK_TZ)).toBe('21:04');
  });

  it('converts a wall-clock time in Mexico City to UTC', () => {
    expect(new Date(zonedTimeToUtc(2026, 11, 9, 21, 4, NETWORK_TZ)).toISOString()).toBe('2026-11-10T03:04:00.000Z');
  });

  it('counts whole hours left, never negative', () => {
    const now = Date.parse('2026-11-09T21:04:00-06:00');
    expect(hoursLeft(now + 72 * 3_600_000, now)).toBe(72);
    expect(hoursLeft(now + 71.9 * 3_600_000, now)).toBe(71);
    expect(hoursLeft(now - 1, now)).toBe(0);
  });
});

describe('asker checkpoints (09:00 and 21:00 in Mexico City)', () => {
  it('finds the last and next checkpoints', () => {
    const at = new Date('2026-11-10T10:30:00-06:00');
    expect(iso(lastCheckpoint(at))).toBe('2026-11-10T15:00:00.000Z'); // 09:00 CST
    expect(iso(nextCheckpoint(at))).toBe('2026-11-11T03:00:00.000Z'); // 21:00 CST
  });

  it('treats a checkpoint instant as the last checkpoint, and crosses midnight', () => {
    expect(iso(lastCheckpoint(new Date('2026-11-10T21:00:00-06:00')))).toBe('2026-11-11T03:00:00.000Z');
    expect(iso(lastCheckpoint(new Date('2026-11-11T02:00:00-06:00')))).toBe('2026-11-11T03:00:00.000Z');
    expect(iso(nextCheckpoint(new Date('2026-11-11T02:00:00-06:00')))).toBe('2026-11-11T15:00:00.000Z');
  });

  it('shows the send result at once, and later member-driven changes only after a checkpoint', () => {
    const sentDone = new Date('2026-11-10T10:05:00-06:00');
    expect(iso(askerAsOf(sentDone, new Date('2026-11-10T10:30:00-06:00')))).toBe(iso(sentDone));
    expect(iso(askerAsOf(sentDone, new Date('2026-11-10T21:30:00-06:00')))).toBe('2026-11-11T03:00:00.000Z');
  });
});

describe('cap months', () => {
  it('use the calendar month in Mexico City', () => {
    expect(capMonth(new Date('2026-12-01T05:59:00Z'))).toBe('2026-11-01');
    expect(capMonth(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12-01');
  });

  it('name the month and its reset day', () => {
    expect(monthName('2026-11-01')).toBe('November');
    expect(resetsOn('2026-11-01')).toBe('Dec 1');
    expect(resetsOn('2026-12-01')).toBe('Jan 1');
    expect(iso(nextMonthStart('2026-12-01'))).toBe('2027-01-01T06:00:00.000Z');
  });
});
