import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkinFooterLinks, offerFooterLinks, RecipientFooter } from '@/components/offer/recipient-footer';
import { excerpt } from '@/lib/emails/html';
import { buildSampleEmail, loopOther, type SampleLoop } from '@/lib/emails/sample';
import { FOOTER_LINE } from '@/lib/site';

/*
 * Footers follow the recipient: askers get Your ask; members get Pause all asks · Change your rules. The offer page
 * leads with Pause all asks. The site is a demo, so nothing links to sign-in or a member page.
 */

const labels = (links: { label: string }[]) => links.map((l) => l.label);

describe('the recipient footer', () => {
  it('members: pause and rules; askers: their ask', () => {
    expect(labels(checkinFooterLinks('sample', 'member', null))).toEqual(['Pause all asks', 'Change your rules']);
    expect(labels(checkinFooterLinks('sample', 'asker', null))).toEqual(['Your ask']);
    expect(labels(offerFooterLinks('sample'))).toEqual(['Pause all asks']);
  });

  it('demo only: links stay in the sample, and nothing points at sign-in or a member page', () => {
    expect(offerFooterLinks('sample')[0]?.href).toBe('/pause/sample');
    expect(checkinFooterLinks('sample', 'asker', 'sa_k3m9q2')[0]?.href).toBe('/ask/sa_k3m9q2');
    expect(checkinFooterLinks('sample', 'asker', null)[0]?.href).toBe('/ask/sa_health');
    expect(checkinFooterLinks('real', 'asker', 'a_91xQ2k')[0]?.href).toBe('/ask/a_91xQ2k');
    expect(checkinFooterLinks('example', 'member', null).map((l) => l.href)).toEqual(['/pause/sample', '/rules']);
    const all = [...offerFooterLinks('real'), ...offerFooterLinks('sample'), ...(['sample', 'example', 'real'] as const).flatMap((m) => [...checkinFooterLinks(m, 'member', null), ...checkinFooterLinks(m, 'asker', null)])];
    for (const l of all) expect(l.href).not.toMatch(/^\/(me|join)/);
  });

  it('renders the shared footer’s markup and disclaimer, led by the recipient’s links', () => {
    const html = renderToStaticMarkup(<RecipientFooter links={offerFooterLinks('sample')} />);
    expect(html).toContain('<footer class="site-footer offer-footer">');
    expect(html).toContain(FOOTER_LINE);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Pause all asks Privacy Code (MIT)');
    const ck = renderToStaticMarkup(<RecipientFooter links={checkinFooterLinks('sample', 'asker', null)} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(ck).toContain('Your ask Privacy Code (MIT)');
    expect(ck).not.toContain('Board');
  });
});

describe('small helpers', () => {
  it('excerpt cuts at a word and ends with an ellipsis', () => {
    expect(excerpt('B2B founders selling to enterprise customers')).toBe('B2B founders selling to enterprise…');
    expect(excerpt('Churn')).toBe('Churn');
    expect(excerpt('a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p', 12)).toBe('a, b, c, d…');
    expect(excerpt('Supercalifragilisticexpialidocious-and-more', 10)).toBe('Supercalif…');
  });

  it('a SAMPLE loop never makes the visitor “the other person” in a check-in', () => {
    const loop: SampleLoop = {
      askId: 'sa_eng',
      subject: 'Churn after month 3: a 20-minute call',
      parts: { challenge: '31 of 120 accounts left last quarter, most after month 3', tried: 'Monthly partitions', needs: 'someone who has cut early churn in a B2B product', by: 'Nov 21', offers: 'Our cancellation interview notes' },
      price: null,
      asker: { name: 'Sample founder', first: 'the founder', company: 'Tidewell Data', stage: 'Seed', city: 'San Francisco' },
      member: { you: true, name: 'You', first: 'you', line: null, scheduling: null },
      matched: 'founders about churn, activation or support load',
      cap: 2,
      nth: 1,
      offeredAt: Date.parse('2026-11-09T17:00:00Z'),
      introAt: Date.parse('2026-11-09T18:00:00Z'),
      question: null,
    };
    expect(loopOther(loop, 'member')).toEqual({ name: 'Sample founder', first: 'the founder' });
    expect(loopOther(loop, 'asker')).toEqual({ name: 'The member', first: 'the member' });
    expect(buildSampleEmail('checkin-1d', { who: 'asker', loop }).message.subject).toBe('Did you and the member talk?');
    expect(buildSampleEmail('checkin-1d', { who: 'member', loop }).message.subject).toBe('Did you and the founder talk?');
    const held = { ...loop, member: { you: false, name: 'Hannah Kim', first: 'Hannah', line: 'Runs data infrastructure.', scheduling: 'https://cal.com/hannah-kim/20min' } };
    expect(loopOther(held, 'asker')).toEqual({ name: 'Hannah Kim', first: 'Hannah' });
  });
});
