import { describe, expect, it } from 'vitest';
import { askerAsOf, capMonth, fmtClock, fmtDay, fmtWhen, hoursLeft, lastCheckpoint, monthName, nextCheckpoint, nextMonthStart, NETWORK_TZ, resetsOn, zonedTimeToUtc } from '@/lib/oti/time';

const iso = (d: Date) => d.toISOString();

describe('formatting in a zone', () => {
  it('renders the REAL example exactly as the spec prints it', () => {
    const replyBy = Date.parse('2026-11-12T21:04:00-08:00');
    expect(fmtWhen(replyBy, NETWORK_TZ)).toBe('Thu Nov 12, 21:04 PT');
    expect(fmtDay(replyBy, NETWORK_TZ)).toBe('Nov 12');
    expect(fmtClock(replyBy, NETWORK_TZ)).toBe('21:04');
  });

  it('converts a wall-clock time in Pacific time to UTC', () => {
    expect(new Date(zonedTimeToUtc(2026, 11, 9, 21, 4, NETWORK_TZ)).toISOString()).toBe('2026-11-10T05:04:00.000Z');
  });

  it('counts whole hours left, never negative', () => {
    const now = Date.parse('2026-11-09T21:04:00-08:00');
    expect(hoursLeft(now + 72 * 3_600_000, now)).toBe(72);
    expect(hoursLeft(now + 71.9 * 3_600_000, now)).toBe(71);
    expect(hoursLeft(now - 1, now)).toBe(0);
  });
});

describe('asker checkpoints (09:00 and 21:00 Pacific time (PT))', () => {
  it('finds the last and next checkpoints', () => {
    const at = new Date('2026-11-10T10:30:00-08:00');
    expect(iso(lastCheckpoint(at))).toBe('2026-11-10T17:00:00.000Z'); // 09:00 PT
    expect(iso(nextCheckpoint(at))).toBe('2026-11-11T05:00:00.000Z'); // 21:00 PT
  });

  it('treats a checkpoint instant as the last checkpoint, and crosses midnight', () => {
    expect(iso(lastCheckpoint(new Date('2026-11-10T21:00:00-08:00')))).toBe('2026-11-11T05:00:00.000Z');
    expect(iso(lastCheckpoint(new Date('2026-11-11T02:00:00-08:00')))).toBe('2026-11-11T05:00:00.000Z');
    expect(iso(nextCheckpoint(new Date('2026-11-11T02:00:00-08:00')))).toBe('2026-11-11T17:00:00.000Z');
  });

  it('shows the send result at once, and later member-driven changes only after a checkpoint', () => {
    const sentDone = new Date('2026-11-10T10:05:00-08:00');
    expect(iso(askerAsOf(sentDone, new Date('2026-11-10T10:30:00-08:00')))).toBe(iso(sentDone));
    expect(iso(askerAsOf(sentDone, new Date('2026-11-10T21:30:00-08:00')))).toBe('2026-11-11T05:00:00.000Z');
  });
});

describe('Pacific time across daylight saving', () => {
  it('labels both halves of the year PT and keeps 09:00 and 21:00 on the wall clock', () => {
    const summer = Date.parse('2026-07-10T21:04:00-07:00');
    expect(fmtWhen(summer, NETWORK_TZ)).toBe('Fri Jul 10, 21:04 PT');
    expect(iso(lastCheckpoint(summer))).toBe('2026-07-11T04:00:00.000Z'); // 21:00 PT (PDT)
    expect(iso(nextCheckpoint(summer))).toBe('2026-07-11T16:00:00.000Z'); // 09:00 PT (PDT)
    // The night clocks go back (Nov 1, 2026) the two checkpoints are 13 hours apart.
    expect(iso(nextCheckpoint(new Date('2026-11-01T04:00:00.000Z')))).toBe('2026-11-01T17:00:00.000Z');
    expect(new Date(zonedTimeToUtc(2026, 7, 1, 0, 0, NETWORK_TZ)).toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
});

describe('cap months', () => {
  it('use the calendar month in Pacific time', () => {
    expect(capMonth(new Date('2026-12-01T07:59:00Z'))).toBe('2026-11-01');
    expect(capMonth(new Date('2026-12-01T08:00:00Z'))).toBe('2026-12-01');
  });

  it('name the month and its reset day', () => {
    expect(monthName('2026-11-01')).toBe('November');
    expect(resetsOn('2026-11-01')).toBe('Dec 1');
    expect(resetsOn('2026-12-01')).toBe('Jan 1');
    expect(iso(nextMonthStart('2026-12-01'))).toBe('2027-01-01T08:00:00.000Z');
  });
});
