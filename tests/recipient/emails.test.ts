import { describe, expect, it } from 'vitest';
import {
  checkinEmail,
  codeEmail,
  companyLine,
  emailFragment,
  introEmail,
  introSubject,
  offerEmail,
  outcomeNoteEmail,
  questionEmail,
  SUPABASE_CODE_TEMPLATE,
  withdrawnEmail,
} from '@/lib/emails';
import { esc, factsInOrder, safeHref, withQuery } from '@/lib/emails/html';
import { buildSampleEmail, SAMPLE_EMAILS, type SampleEmailKind, type SampleLoop } from '@/lib/emails/sample';
import { BANNED_COPY } from '@/lib/oti/text';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import type { EmailMessage, OfferEmailInput } from '@/lib/types';

const member = {
  role: 'member' as const,
  pause_url: 'https://oki.example/pause/PAUSETOKEN000000000000',
  rules_url: 'https://oki.example/me#settings',
  delete_url: 'https://oki.example/me#delete',
  unsubscribe_post_url: 'https://oki.example/api/pause?token=PAUSETOKEN000000000000',
};
const asker = { role: 'asker' as const, ask_url: 'https://oki.example/ask/a_91xQ2', delete_url: 'https://oki.example/me#delete' };

function offerInput(over: Partial<OfferEmailInput> = {}): OfferEmailInput {
  return {
    offer_url: 'https://oki.example/o/3Fp9Kx7QmW2cAbCdEfGhIj',
    member_first: 'Priya',
    cap: 2,
    nth: 1,
    asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' },
    subject: 'Hospital procurement in the US, 20 min?',
    title: 'Hospital procurement in the US',
    matched: OFFER_SAMPLE.matched,
    facts: [...OFFER_SAMPLE.facts].reverse(),
    reply_by_label: 'Thu Nov 12, 21:04 PT',
    reply_by_day: 'Thu',
    footer: member,
    ...over,
  };
}

/** Every email, both versions where the role changes it. */
function everySample(): EmailMessage[] {
  const out: EmailMessage[] = [];
  for (const e of SAMPLE_EMAILS) {
    out.push(buildSampleEmail(e.kind).message);
    if (e.roles) out.push(buildSampleEmail(e.kind, { who: 'member' }).message);
  }
  return out;
}

/** Visible text of an email's HTML (tags dropped, entities decoded enough for copy checks). */
function htmlText(html: string): string {
  return emailFragment(html)
    .replace(/<div style="display:none[^"]*">[^<]*<\/div>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

describe('every email follows the email rules (ux-spec S4/S5, tech.md “Rendering”)', () => {
  const all = everySample();

  it('has a subject, a preheader, an HTML part under 20 KB and a plain-text part', () => {
    expect(all.length).toBe(SAMPLE_EMAILS.length + 1);
    for (const m of all) {
      expect(m.subject.length).toBeGreaterThan(0);
      expect(m.preheader.length).toBeGreaterThan(0);
      expect(m.text.length).toBeGreaterThan(20);
      expect(new TextEncoder().encode(m.html).length).toBeLessThan(20_000);
      expect(m.html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    }
  });

  it('is light only, inline-styled, with no images, tracking, style blocks or orange', () => {
    for (const m of all) {
      expect(m.html).not.toMatch(/<img|<style|color-scheme|<script|https?:\/\/[^"]*\.(gif|png|jpg)/i);
      expect(m.html.toLowerCase()).not.toMatch(/#fb651e|#e74d04|#a8420e|#ff6600/);
      // opacity appears only on the hidden preheader
      expect(m.html.match(/opacity/g)?.length ?? 0).toBe(1);
    }
  });

  it('carries the disclaimer, and Y Combinator appears nowhere else', () => {
    for (const m of all) {
      expect(m.text).toContain('Independent project, not affiliated with Y Combinator.');
      expect(htmlText(m.html)).toContain('Independent project, not affiliated with Y Combinator.');
      expect((m.text.match(/Y Combinator/g) ?? []).length).toBe(1);
    }
  });

  it('uses curly quotes and apostrophes and none of the banned words', () => {
    for (const m of all) {
      const copy = `${m.subject}\n${m.preheader}\n${m.text.replace(/https?:\/\/\S+/g, '')}\n${htmlText(m.html)}`;
      expect(copy).not.toMatch(/['"]/);
      for (const re of BANNED_COPY) expect(copy).not.toMatch(re);
    }
  });

  it('every link is http(s) or mailto, and every button is at least 48 px tall', () => {
    for (const m of all) {
      for (const [, href] of m.html.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^(https?:|mailto:)/);
      // ink 14+20+14, outline 1+13+20+13+1, squares 1+46+1
      const buttons = [...m.html.matchAll(/<a href="[^"]*" style="display:inline-block;([^"]*)"/g)].map((x) => x[1] as string);
      for (const style of buttons) expect(style).toMatch(/padding:14px 24px;font:500 16px\/20px|padding:13px 22px;font:500 16px\/20px|width:46px;text-align:center;font:500 18px\/46px/);
    }
  });
});

describe('offer email', () => {
  const m = offerEmail(offerInput());

  it('reads in the spec order: cap line, title, from, matched rule, facts, three buttons, the two notes', () => {
    const order = [
      '>An ask matched your rules. It’s 1 of your 2 this month.<',
      '>Hospital procurement in the US</h1>',
      '>From Maya Bennett, Oakline Health (Seed, Chicago)<',
      'Matched your rule: <span style="background:#fbe9b7;color:#16140f;padding:0 2px">“B2B founders selling to public hospitals or insurers in the US or Canada”</span>',
      '>Problem</td>',
      '>Needs</td>',
      '>Price</td>',
      '>OK to intro</a>',
      '>Answer in 2 lines</a>',
      '>No</a>',
      '>Each button opens a page where you confirm. Nothing happens from this email.<',
      '>Maya sees your name only if you choose OK. If you say No or don’t reply by Thu Nov 12, 21:04 PT, it goes to the next person and Maya isn’t told it reached you.<',
    ].map((s) => m.html.indexOf(s));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > (order[i - 1] as number)))).toBe(true);
  });

  it('puts Problem first and Needs reads “20 minutes with …” (Revision 3)', () => {
    const labels = [...m.html.matchAll(/text-transform:uppercase;color:#5f5a50">(\w+)<\/td>/g)].map((x) => x[1]);
    expect(labels).toEqual(['Problem', 'Needs', 'Tried', 'By', 'Offers', 'Price']);
    expect(m.text).toMatch(/^Needs:\s+20 minutes with someone/m);
    expect(m.text.indexOf('Problem:')).toBeLessThan(m.text.indexOf('Needs:'));
  });

  it('links OK, Answer and No to the offer page with the choice preselected (OK in ink with a white label)', () => {
    expect(m.html).toContain('<td bgcolor="#16140f" style="border-radius:999px"><a href="https://oki.example/o/3Fp9Kx7QmW2cAbCdEfGhIj?choice=ok"');
    expect(m.html).toMatch(/choice=ok"[^>]*color:#ffffff/);
    expect(m.html.indexOf('?choice=ok')).toBeLessThan(m.html.indexOf('?choice=answer'));
    expect(m.html.indexOf('?choice=answer')).toBeLessThan(m.html.indexOf('?choice=no'));
    expect(m.text).toContain('OK to intro:\nhttps://oki.example/o/3Fp9Kx7QmW2cAbCdEfGhIj?choice=ok');
    expect(m.text).toContain('Each link opens a page where you confirm. Nothing happens from this email.');
  });

  it('sets one-click pause headers and the member footer', () => {
    expect(m.headers).toEqual({ 'List-Unsubscribe': `<${member.unsubscribe_post_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(m.text).toContain(`Pause all asks: ${member.pause_url}\nChange your rules: ${member.rules_url}\nDelete my data: ${member.delete_url}`);
    // The quote is cut at a word so the cap and the reply-by day survive an inbox's preview length.
    expect(m.preheader).toBe('Matched your rule “B2B founders selling to public hospitals…” · 1 of your 2 this month · reply by Thu');
    expect(m.preheader.length).toBeLessThanOrEqual(105);
    expect(m.subject).toBe('Hospital procurement in the US, 20 min?');
  });

  it('escapes everything the asker wrote', () => {
    const evil = offerEmail(offerInput({ title: '<script>alert(1)</script>', facts: [['Problem', '"><img src=x onerror=alert(1)>']], asker: { name: 'A&B <x>', first: 'A', company: 'C', stage: 'S', city: 'Q' } }));
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).not.toContain('<img');
    expect(evil.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(evil.html).toContain('A&amp;B &lt;x&gt;');
    expect(evil.text).toContain('<script>alert(1)</script>');
  });

  it('a partial asker profile never prints empty parentheses, and a missing quote never prints an empty one', () => {
    const partial = offerEmail(offerInput({ asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: '', city: 'Chicago' }, matched: '' }));
    expect(partial.text).toContain('From Maya Bennett, Oakline Health (Chicago)');
    expect(partial.text).toContain('\nMatched your rules.\n');
    expect(partial.text).not.toContain('“”');
    expect(partial.preheader).toBe('Matched your rules · 1 of your 2 this month · reply by Thu');
    expect(htmlText(partial.html)).not.toMatch(/\(\s*,|,\s*\)|\(\s*\)/);
    expect(companyLine({ company: '', stage: 'Seed', city: '' })).toBe('Seed');
    expect(companyLine({ company: 'Oakline Health', stage: '', city: '' })).toBe('Oakline Health');
  });

  it('keeps an existing query string when it adds the choice (SAMPLE loop links)', () => {
    const loop = offerEmail(offerInput({ offer_url: 'https://oki.example/o/sample?ask=sa_eng' }));
    expect(loop.html).toContain('https://oki.example/o/sample?ask=sa_eng&amp;choice=ok');
  });
});

describe('intro email', () => {
  const input = {
    member_context: 'public hospital procurement',
    member: { name: 'Priya Shah', first: 'Priya', one_line: 'Ran procurement for a public hospital network in Illinois.', scheduling_url: 'https://cal.com/priya-shah/20min', email: 'priya@example.com' },
    asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago', email: 'maya@oakline.example' },
    facts: [...OFFER_SAMPLE.facts],
    matched_line: OFFER_SAMPLE.matched,
    checkin_d1_label: 'Tue Nov 10',
    checkin_d14_label: 'Mon Nov 23',
    member_footer: member,
  };

  it('opens with both names and one-liners, quotes the approved facts and the scheduling link', () => {
    const m = introEmail(input);
    expect(m.subject).toBe('Intro: Maya Bennett (Oakline Health) and Priya Shah (public hospital procurement)');
    expect(introSubject({ ...input, member_context: null })).toBe('Intro: Maya Bennett (Oakline Health) and Priya Shah');
    expect(m.text.split('\n').slice(0, 4)).toEqual([
      'Priya Shah · Ran procurement for a public hospital network in Illinois.',
      'Maya Bennett · Oakline Health (Seed, Chicago)',
      '',
      'Maya, Priya: you both said yes, so here is the intro.',
    ]);
    expect(m.text).toContain('The ask Maya approved:\nProblem:');
    expect(m.text).toContain('Priya’s link for 20 minutes: https://cal.com/priya-shah/20min');
    expect(m.html).toContain('<a href="https://cal.com/priya-shah/20min"');
    expect(m.text).toContain('Priya’s rules include “B2B founders selling to public hospitals or insurers in the US or Canada”.');
    expect(m.text).toContain('Reply all to pick a time. We’re not on this thread. Tomorrow we’ll ask each of you one question, and Maya one more in two weeks. That’s all.');
    expect(m.preheader).toBe('Reply all to pick a time. Priya’s link: cal.com/priya-shah/20min');
  });

  it('never hands the asker the member’s pause token, and has no one-click header (it goes to both people)', () => {
    const m = introEmail(input);
    expect(m.headers).toEqual({});
    expect(m.html).not.toContain('PAUSETOKEN');
    expect(m.text).not.toContain('PAUSETOKEN');
    expect(m.text).toMatch(/Pause asks: https?:\/\/[^\s]+\/me$/m);
  });

  it('names the asker without empty parentheses when the profile is partial', () => {
    const m = introEmail({ ...input, asker: { ...input.asker, company: '', stage: 'Seed', city: '' } });
    expect(m.subject).toBe('Intro: Maya Bennett and Priya Shah (public hospital procurement)');
    expect(m.text.split('\n')[1]).toBe('Maya Bennett · Seed');
    expect(htmlText(m.html)).not.toMatch(/\(\s*,|,\s*\)|\(\s*\)/);
  });

  it('keeps the matched rule private unless the member turned it on, and drops a missing link', () => {
    const m = introEmail({ ...input, matched_line: null, member: { ...input.member, scheduling_url: null } });
    expect(m.text).not.toContain('rules include');
    expect(m.text).not.toContain('link for 20 minutes');
    expect(m.preheader).toBe('Reply all to pick a time.');
  });
});

describe('check-in emails', () => {
  it('+1 day, asker: 1–5, not yet, won’t happen; asker footer; no one-click header', () => {
    const m = checkinEmail({ kind: 'd1', role: 'asker', to_first: 'Maya', other_name: 'Priya Shah', other_first: 'Priya', checkin_url: 'https://oki.example/c/c88Lq2Hd7AbCdEfGhIjKlM', footer: asker });
    expect(m.subject).toBe('Did you and Priya talk?');
    expect(m.preheader).toBe('One tap: how useful was the call with Priya?');
    expect(m.text.startsWith('How useful was the call with Priya?\n\n1: https://oki.example/c/c88Lq2Hd7AbCdEfGhIjKlM?v=1')).toBe(true);
    expect(m.text).toContain('We haven’t talked yet: https://oki.example/c/c88Lq2Hd7AbCdEfGhIjKlM?v=notyet');
    expect(m.text).toContain('It won’t happen: https://oki.example/c/c88Lq2Hd7AbCdEfGhIjKlM?v=wont');
    expect(m.text).toContain('1 = not at all · 5 = it unblocked me\nOne tap opens a page where you confirm.');
    expect(m.text).toContain(`Your ask: ${asker.ask_url}\nDelete my data: ${asker.delete_url}`);
    expect(m.text).not.toContain('Pause all asks');
    expect(m.headers).toEqual({});
  });

  it('+1 day, member: its own question, the member footer and the one-click pause header', () => {
    const m = checkinEmail({ kind: 'd1', role: 'member', to_first: 'Priya', other_name: 'Maya Bennett', other_first: 'Maya', checkin_url: 'https://oki.example/c/c88Ma4Rt9BbCdEfGhIjKlM', footer: member });
    expect(m.subject).toBe('Did you and Maya talk?');
    expect(m.text.startsWith('Was the call with Maya worth your 20 minutes?')).toBe(true);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('+14 days: the five outcomes', () => {
    const m = checkinEmail({ kind: 'd14', role: 'asker', to_first: 'Maya', other_name: 'Priya Shah', other_first: 'Priya', checkin_url: 'https://oki.example/c/c91Vk3Np5CbCdEfGhIjKlM', footer: asker });
    expect(m.subject).toBe('What came of the intro to Priya?');
    expect([...m.text.matchAll(/^([A-Z][\w ]+): https\S+\?v=/gm)].map((x) => x[1])).toEqual(['Unblocked', 'A customer', 'A hire', 'An investor', 'Nothing yet']);
    expect(m.text).toContain('?v=nothing_yet');
  });
});

describe('question, outcome note, withdrawn and the sign-in code', () => {
  it('question: one gate or several, a button to the ask', () => {
    const one = questionEmail({ asker_first: 'Maya', ask_subject: 'Hospital procurement in the US, 20 min?', question: { type: 'price', text: 'What do you charge per hospital, per year?' }, gates: 1, ask_url: 'https://oki.example/ask/a_91xQ2', footer: asker });
    expect(one.subject).toBe('One question about your ask: Hospital procurement in the US');
    expect(one.text).toContain('A member’s gate has one question before deciding: “What do you charge per hospital, per year?” Your answer goes only to the gate that asked, and it reruns once.');
    expect(one.text).toContain('Answer it:\nhttps://oki.example/ask/a_91xQ2#question');
    const two = questionEmail({ asker_first: 'Maya', ask_subject: 'X', question: { type: 'price', text: 'Q?' }, gates: 2, ask_url: 'https://oki.example/ask/a_1', footer: asker });
    expect(two.text).toContain('Your answer goes only to the gates that asked (2), and each reruns once.');
  });

  it('outcome note', () => {
    const m = outcomeNoteEmail({ member_first: 'Priya', asker_first: 'Maya', outcome: 'customer', reported_on: 'Nov 23', footer: member });
    expect(m.subject).toBe('What came of your intro to Maya');
    expect(m.text.split('\n')[0]).toBe('Maya reported a customer from your intro (Nov 23). Thanks for the 20 minutes.');
    expect(m.preheader).toBe('Maya reported a customer.');
  });

  it('withdrawn: nothing to do, and it still counted', () => {
    const m = withdrawnEmail({ member_first: 'Priya', asker_first: 'Maya', title: 'Hospital procurement in the US', withdrawn_on: 'Tue Nov 10', cap: 2, nth: 1, footer: member });
    expect(m.subject).toBe('No longer needed: Hospital procurement in the US');
    expect(m.text.split('\n')[0]).toBe('Maya withdrew the ask “Hospital procurement in the US” on Tue Nov 10. Nothing to do. It still counted as 1 of your 2 this month.');
  });

  it('code: the code in the subject and the first line; the Supabase template keeps {{ .Token }}', () => {
    const m = codeEmail({ code: '482913', minutes: 15 });
    expect(m.subject).toBe('482913 is your OK to Intro code');
    expect(m.text.split('\n')[0]).toBe('Your code: 482913. It expires in 15 minutes. If you didn’t ask for it, ignore this email.');
    expect(SUPABASE_CODE_TEMPLATE.subject).toBe('{{ .Token }} is your OK to Intro code');
    expect(SUPABASE_CODE_TEMPLATE.html).toContain('{{ .Token }}');
  });
});

describe('SAMPLE emails from the visitor’s loop', () => {
  const loop: SampleLoop = {
    askId: 'sa_eng',
    subject: 'Postgres p95 at 40M rows, 20 min?',
    parts: { challenge: 'Postgres p95 went from 40 ms to 900 ms past 40M rows', tried: 'Monthly partitions and a read replica', needs: 'Someone who has run Postgres past 100M rows', by: 'Nov 21', offers: 'Our load-test harness' },
    price: null,
    asker: { name: 'Sample founder', first: 'the founder', company: 'Tidewell Data', stage: 'Seed', city: 'San Francisco' },
    member: { you: false, name: 'Hannah Kim', first: 'Hannah', line: 'Runs data infrastructure at a payments company in San Francisco.', scheduling: 'https://cal.com/hannah-kim/20min' },
    matched: 'Happy to talk about Postgres or Kafka at scale',
    cap: 2,
    nth: 2,
    offeredAt: Date.parse('2026-11-09T18:00:00Z'),
    introAt: Date.parse('2026-11-09T18:05:00Z'),
    question: null,
  };

  it('the intro names the member who held the offer and quotes the ask that was sent', () => {
    const e = buildSampleEmail('intro', { loop, tz: 'America/Los_Angeles' });
    expect(e.message.subject).toBe('Intro: Sample founder (Tidewell Data) and Hannah Kim');
    expect(e.message.text).toContain('Sample founder and Hannah: you both said yes, so here is the intro.');
    expect(e.message.text).toContain('The ask the founder approved:');
    expect(e.message.text).toContain('Needs:   20 minutes with someone who has run Postgres past 100M rows');
    expect(e.message.text).toContain('The rule that matched stays private unless the member turns it on.');
    expect(e.to).toContain('hannah@example.com');
  });

  it('when the visitor’s own gate held it, the intro says you and has no link yet', () => {
    const e = buildSampleEmail('intro', { loop: { ...loop, member: { you: true, name: 'You', first: 'you', line: 'the member whose gate accepted (your one line goes here when you join)', scheduling: null } }, tz: 'America/Los_Angeles' });
    expect(e.message.subject).toBe('Intro: Sample founder (Tidewell Data) and you');
    expect(e.message.text).toContain('Your link for 20 minutes: the scheduling link you add when you join.');
  });

  it('the offer email keeps the loop’s ask id in every button', () => {
    const e = buildSampleEmail('offer', { loop, tz: 'America/Los_Angeles' });
    expect(e.message.text).toMatch(/\/o\/sample\?ask=sa_eng&choice=ok/);
    expect(e.message.text).toContain('reply by Thu Nov 12, 10:00 PT');
  });

  it('every kind builds with and without a loop', () => {
    for (const k of SAMPLE_EMAILS.map((x) => x.kind) as SampleEmailKind[]) {
      expect(buildSampleEmail(k).message.subject).toBeTruthy();
      expect(buildSampleEmail(k, { loop }).message.subject).toBeTruthy();
    }
  });
});

describe('html helpers', () => {
  it('withQuery, esc, safeHref, factsInOrder', () => {
    expect(withQuery('https://x.example/c/t', 'v', '4')).toBe('https://x.example/c/t?v=4');
    expect(withQuery('https://x.example/c/t?who=member#a', 'v', 'nothing_yet')).toBe('https://x.example/c/t?who=member&v=nothing_yet#a');
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('https://ok.example/?a=1&b=2')).toBe('https://ok.example/?a=1&amp;b=2');
    expect(factsInOrder([['Price', 'p'], ['By', 'b'], ['Problem', 'x'], ['Tried', '']]).map(([k]) => k)).toEqual(['Problem', 'By', 'Price']);
  });

  it('emailFragment returns the preheader and the card only', () => {
    const m = codeEmail({ code: '1', minutes: 1 });
    const f = emailFragment(m.html);
    expect(f.startsWith('<div style="display:none')).toBe(true);
    expect(f).not.toContain('<body');
  });
});
