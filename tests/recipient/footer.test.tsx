import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkinFooterLinks, offerFooterLinks, RecipientFooter } from '@/components/offer/recipient-footer';
import { excerpt } from '@/lib/emails/html';
import { buildSampleEmail, loopOther, type SampleLoop } from '@/lib/emails/sample';
import { FOOTER_LINE } from '@/lib/site';

/*
 * ux-spec S5: “Footers follow the recipient: askers get Your ask · Delete my data; members get Pause all asks ·
 * Change your rules · Delete my data.” The offer page leads with Pause all asks (prototype offer.html).
 */

const labels = (links: { label: string }[]) => links.map((l) => l.label);

describe('the recipient footer', () => {
  it('members: pause, rules, delete; askers: their ask and delete', () => {
    expect(labels(checkinFooterLinks('real', 'member', null))).toEqual(['Pause all asks', 'Change your rules', 'Delete my data']);
    expect(labels(checkinFooterLinks('real', 'asker', null))).toEqual(['Your ask', 'Delete my data']);
    expect(labels(offerFooterLinks('real'))).toEqual(['Pause all asks']);
  });

  it('SAMPLE links stay in the sample; REAL links go to the member’s own gate', () => {
    expect(offerFooterLinks('sample')[0]?.href).toBe('/pause/sample');
    expect(offerFooterLinks('real')[0]?.href).toBe('/me#settings');
    expect(checkinFooterLinks('sample', 'asker', 'sa_k3m9q2')[0]?.href).toBe('/ask/sa_k3m9q2');
    expect(checkinFooterLinks('sample', 'asker', null)[0]?.href).toBe('/ask/sa_health');
    expect(checkinFooterLinks('real', 'asker', 'a_91xQ2k')[0]?.href).toBe('/ask/a_91xQ2k');
    expect(checkinFooterLinks('real', 'asker', null)[0]?.href).toBe('/me#asks');
    expect(checkinFooterLinks('example', 'member', null).map((l) => l.href)).toEqual(['/me#settings', '/me#settings', '/me#delete']);
  });

  it('renders the shared footer’s markup and disclaimer, led by the recipient’s links', () => {
    const html = renderToStaticMarkup(<RecipientFooter links={offerFooterLinks('sample')} />);
    expect(html).toContain('<footer class="site-footer offer-footer">');
    expect(html).toContain(FOOTER_LINE);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Pause all asks Board Privacy Code (MIT)');
    const ck = renderToStaticMarkup(<RecipientFooter links={checkinFooterLinks('sample', 'asker', null)} board={false} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(ck).toContain('Your ask Delete my data Privacy Code (MIT)');
    expect(ck).not.toContain('Board');
  });
});

describe('small helpers', () => {
  it('excerpt cuts at a word and ends with an ellipsis', () => {
    expect(excerpt('B2B founders selling to public hospitals or insurers in Mexico or Colombia')).toBe('B2B founders selling to public hospitals…');
    expect(excerpt('Postgres at scale')).toBe('Postgres at scale');
    expect(excerpt('a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p', 12)).toBe('a, b, c, d…');
    expect(excerpt('Supercalifragilisticexpialidocious-and-more', 10)).toBe('Supercalif…');
  });

  it('a SAMPLE loop never makes the visitor “the other person” in a check-in', () => {
    const loop: SampleLoop = {
      askId: 'sa_eng',
      subject: 'Postgres p95 at 40M rows, 20 min?',
      parts: { challenge: 'Postgres p95 went from 40 ms to 900 ms past 40M rows', tried: 'Monthly partitions', needs: 'someone who has run Postgres past 100M rows', by: 'Nov 21', offers: 'Our load-test harness' },
      price: null,
      asker: { name: 'Sample founder', first: 'the founder', company: 'Arrecife Data', stage: 'Seed', city: 'Mexico City' },
      member: { you: true, name: 'You', first: 'you', line: null, scheduling: null },
      matched: 'founders about Postgres, queues or LLM evals in production',
      cap: 2,
      nth: 1,
      offeredAt: Date.parse('2026-11-09T15:00:00Z'),
      introAt: Date.parse('2026-11-09T16:00:00Z'),
      question: null,
    };
    expect(loopOther(loop, 'member')).toEqual({ name: 'Sample founder', first: 'the founder' });
    expect(loopOther(loop, 'asker')).toEqual({ name: 'The member', first: 'the member' });
    expect(buildSampleEmail('checkin-1d', { who: 'asker', loop }).message.subject).toBe('Did you and the member talk?');
    expect(buildSampleEmail('checkin-1d', { who: 'member', loop }).message.subject).toBe('Did you and the founder talk?');
    const held = { ...loop, member: { you: false, name: 'Sofía Peralta', first: 'Sofía', line: 'Runs data infrastructure.', scheduling: 'https://cal.com/sofia-peralta/20min' } };
    expect(loopOther(held, 'asker')).toEqual({ name: 'Sofía Peralta', first: 'Sofía' });
  });
});
