import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckinScreen } from '@/components/checkin/checkin-screen';
import { uiFromQuery as ckUi, parseCheckinQuery, type CheckinPageModel } from '@/components/checkin/model';
import { parseOfferQuery, uiFromQuery, type OfferPageModel, type OfferUi } from '@/components/offer/model';
import { OfferMeta } from '@/components/offer/offer-meta';
import { OfferScreen } from '@/components/offer/offer-screen';
import { canonicalCard } from '@/components/offer/sample-loop';
import { SUGGESTED_EDIT_UNTESTED } from '@/lib/oti/copy';
import { BANNED_COPY } from '@/lib/oti/text';
import { OFFER_SAMPLE } from '@/lib/sample/offer';

/*
 * Server-rendered markup of the recipient screens in each designed state: the exact copy, one order for the actions,
 * one primary per view, honest labels, and no JS needed to act (every change is a form).
 */

const noop = async () => undefined;
const actions = { respond: noop, reason: noop, follow: noop };

function offerModel(state: string, over: Partial<OfferPageModel> = {}, extra: Record<string, string> = {}): OfferPageModel {
  const ui: OfferUi = uiFromQuery(parseOfferQuery({ state, ...extra }, true));
  const sample = over.mode === 'sample';
  return {
    nonce: 'n',
    self: '/o/demo',
    mode: 'example',
    ui,
    card: canonicalCard(),
    source: sample ? { kind: 'canonical' } : { kind: 'none' },
    hours: 71,
    pausedUntil: ui.paused ? 'Dec 1' : null,
    pauseUntil: 'Dec 1',
    edit: ui.why === 'area' || ui.why === 'stage' ? { context: OFFER_SAMPLE.suggested_edits[ui.why].context, add: OFFER_SAMPLE.suggested_edits[ui.why].add, caption: OFFER_SAMPLE.suggested_edits[ui.why].expected } : null,
    rulesVersion: 4,
    acted: { iso: '2026-11-09T21:16:00-08:00', text: 'Mon Nov 9 at 21:16' },
    okAt: { iso: '2026-11-09T21:16:00-08:00', text: '21:16' },
    expiredAt: { iso: '2026-11-12T21:04:00-08:00', text: 'Thu Nov 12 at 21:04' },
    withdrawnOn: { iso: '2026-11-10T10:12:00-08:00', text: 'Tue Nov 10' },
    scheduling: true,
    base: true,
    forms: { ref: 'demo', csrf: 'example', mode: 'example', offerId: 'o_3Fp9', keep: {} },
    justActed: false,
    ...over,
  };
}

const render = (m: OfferPageModel) => renderToStaticMarkup(<OfferScreen model={m} actions={actions} />);
/** Visible text, roughly (tags dropped). */
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('/o: the decision', () => {
  it('open: the card in spec order, then OK to intro · Answer in 2 lines · No, in the row and the phone bar', () => {
    const html = render(offerModel('open'));
    const t = text(html);
    expect(t).toContain('Intro to a hospital procurement lead');
    expect(t).toContain('Maya Bennett · Oakline Health · Seed · Chicago');
    expect(t).toContain('Matched your rule: “B2B founders selling to enterprise customers”');
    expect(t).toContain('Maya sees your name only if you choose OK. A No is private. This counts as 1 of your 2 whatever you answer.');
    const desk = html.slice(html.indexOf('id="offer-desk"'), html.indexOf('id="offer-g-ok"'));
    expect([...desk.matchAll(/data-key="(\w+)"/g)].map((x) => x[1])).toEqual(['ok', 'answer', 'no']);
    const bar = html.slice(html.indexOf('id="offer-bar"'));
    expect([...bar.matchAll(/data-key="(\w+)"/g)].map((x) => x[1])).toEqual(['ok', 'answer', 'no']);
    // One primary per copy (desk and bar), and it is the orange OK.
    expect(desk.match(/data-primary/g)).toHaveLength(1);
    expect(bar.match(/data-primary/g)).toHaveLength(1);
    expect(desk).toMatch(/class="btn btn--ok btn--lg"[^>]*data-primary/);
    expect(html).toContain('aria-keyshortcuts="1"');
    expect(html).toContain('data-has-bar="lg"');
    expect(html).not.toContain('Sample');
  });

  it('works without JS: GET forms preselect, POST forms act; no idempotency key comes from the page', () => {
    const html = render(offerModel('open'));
    expect(html).toContain('<form id="offer-g-ok" data-view="confirm" action="/o/demo" method="get"><input type="hidden" name="state" value="confirm-ok"/></form>');
    expect(html).toMatch(/<form id="offer-f-no" data-act="no"[^>]*><input type="hidden" name="ref" value="demo"\/><input type="hidden" name="csrf" value="example"\/>/);
    expect(html).toContain('<button type="submit" class="btn btn--lg" aria-keyshortcuts="3" form="offer-f-no" data-key="no">No</button>');
    expect(html).not.toContain('idempotency_key');
    expect(html).toContain('name="text"');
    expect(html).toMatch(/<textarea[^>]*required=""/);
  });

  it('?choice=no moves the primary to No and says one tap passes', () => {
    const html = render(offerModel('open', {}, { choice: 'no' }));
    expect(text(html)).toContain('One tap on No passes. Maya won’t be told.');
    const desk = html.slice(html.indexOf('id="offer-desk"'), html.indexOf('id="offer-g-ok"'));
    expect(desk).toMatch(/<button[^>]*data-primary=""[^>]*data-key="no"/);
    expect(desk).not.toMatch(/<button[^>]*data-primary=""[^>]*data-key="ok"/);
  });

  it('confirm (the email’s OK): Send intro, orange, then Back', () => {
    const t = text(render(offerModel('confirm-ok')));
    expect(t).toContain('Send the intro email to you and Maya? Send intro Back');
  });

  it('answer: the composer, 0 / 280, help, Send answer disabled until there is text', () => {
    const html = render(offerModel('answer'));
    const t = text(html);
    expect(t).toContain('Your answer, in 2 lines 0 / 280');
    expect(t).toContain('Sent without your name. No intro, no meeting.');
    expect(html).toMatch(/btn--primary btn--lg"[^>]*form="offer-f-answer"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<form class="offer-compose"[^>]*hidden/);
  });

  it('paused member and a failed POST', () => {
    expect(text(render(offerModel('paused-member')))).toContain('Your asks are paused until Dec 1. This one arrived before you paused; you can still answer it.');
    expect(text(render(offerModel('post-failed')))).toContain('Didn’t go through. Check your connection and tap again; nothing happens twice.');
  });

  it('SAMPLE carries its tag and says no email is sent', () => {
    const html = render(offerModel('open', { mode: 'sample' }));
    expect(text(html)).toContain('Sample Buttons show what happens; no email is sent.');
  });
});

describe('/o: after the decision', () => {
  it('ok-sent (REAL copy) and the SAMPLE version with its intro email link', () => {
    const real = text(render(offerModel('ok-sent')));
    expect(real).toContain('Intro sent.');
    expect(real).toContain('We emailed you and Maya at 21:16 , with your scheduling link. Reply-all to pick a time. Tomorrow we’ll ask you both one question: did the call happen?');
    expect(real).toContain('This used 1 of your 2 this month.');
    expect(real).toContain('Be asked ›');
    const sample = render(offerModel('ok-sent', { mode: 'sample' }));
    expect(text(sample)).toContain('Sample Intro sent (sample, no email sent).');
    expect(sample).toContain('href="/emails/intro"');
    expect(text(sample)).toContain('Back to the playground ›');
  });

  it('answer-sent, already-acted, expired, withdrawn', () => {
    expect(text(render(offerModel('answer-sent')))).toContain('Sent. Maya gets your 2 lines without your name. This used 1 of your 2 this month.');
    expect(text(render(offerModel('already-acted')))).toContain('You said OK on Mon Nov 9 at 21:16 . The intro email went to you both.');
    expect(text(render(offerModel('already-acted', {}, { did: 'no' })))).toContain('You passed on Mon Nov 9 at 21:16 .');
    expect(text(render(offerModel('expired')))).toContain('This ask went to the next person on Thu Nov 12 at 21:04 , after 72 hours without a reply. Maya wasn’t told it reached you. It still counted as 1 of your 2 this month.');
    expect(text(render(offerModel('withdrawn')))).toContain('Maya withdrew this ask on Tue Nov 10 . Nothing to do. It still counted as 1 of your 2 this month.');
  });

  it('No: passed, then an optional private reason with five choices', () => {
    const html = render(offerModel('no-done'));
    const t = text(html);
    expect(t).toContain('Passed. Maya won’t be told. It goes to the next person whose rules accepted it. This still counts as 1 of your 2 this month.');
    expect(t).toContain('Why? Optional. Only you see this. Not my area Wrong stage Not specific No time this month Other');
    expect(html.match(/<button class="chip" type="submit" value="\w+" aria-pressed="false" data-value="\w+" name="why">/g)).toHaveLength(5);
  });

  it('Not my area: the templated diff, labelled as hand-written on SAMPLE data; REAL says it wasn’t run', () => {
    const html = render(offerModel('no-reason-diff', {}, { why: 'area' }));
    const t = text(html);
    expect(t).toContain('Suggested change to your rules');
    expect(html).toContain('<span class="d-add"><span class="sr-only">Add: </span>No asks about procurement.</span>');
    expect(t).toContain('Expected on the 12 sample asks (written by hand, not a model run): 1 change (Oakline Health: question first → decline). Nothing else changes.');
    expect(t).not.toMatch(/Tested on/);
    expect(html).toContain('<button type="submit" class="btn btn--primary" data-primary="" form="offer-f-add" data-why="add">Add to my rules</button>');
    expect(html).toMatch(/<button class="chip" type="submit" value="area" aria-pressed="true"/);
    const real = render(offerModel('no-reason-diff', { mode: 'real', edit: { context: 'x', add: 'Only after a first paying customer.', caption: SUGGESTED_EDIT_UNTESTED } }, { why: 'stage' }));
    expect(text(real)).toContain(SUGGESTED_EDIT_UNTESTED);
  });

  it('applied, no time this month, not specific, other', () => {
    expect(text(render(offerModel('diff-applied', {}, { why: 'area' })))).toContain('Rules updated, version 4. Undo');
    expect(text(render(offerModel('no-reason-busy')))).toContain('Lower my cap to 1 Pause until Dec 1');
    expect(text(render(offerModel('no-reason-busy', {}, { step: 'pause' })))).toContain('Paused until Dec 1. Offers go to others.');
    expect(text(render(offerModel('no-done', {}, { why: 'vague' })))).toContain('Thanks. This goes to the compiler, not to your rules.');
    const other = text(render(offerModel('no-done', {}, { why: 'other' })));
    expect(other).toContain('Your reason 0 / 140');
    expect(other).toContain('Only you and Alan see this.');
  });

  it('invalid, not set up, and something broke: no card, one way forward', () => {
    const invalid = text(render(offerModel('invalid', { card: null })));
    expect(invalid).toContain('This link doesn’t match an offer. It may be mistyped or expired. This site is a demo, so no real offers exist. See a sample offer ›');
    const unconfigured = render(offerModel('open', { mode: 'real', card: null, forms: null, ui: { ...offerModel('open').ui, view: 'unconfigured' } }));
    // Not configured is a setup state, never an outage or a wrong link (CONTRACT §e.8); SAMPLE still works.
    expect(text(unconfigured)).toContain('Offers aren’t set up on this instance This instance has no database connected, so this link can’t be looked up. Nothing was sent to anyone. See a sample offer ›');
    expect(unconfigured).not.toContain('broke');
    expect(unconfigured).not.toContain('doesn’t match');
    const broken = render(offerModel('open', { mode: 'real', card: null, forms: null, self: '/o/x?choice=ok', ui: { ...offerModel('open').ui, view: 'broken' } }));
    expect(text(broken)).toContain('Something broke on our side Nothing was sent to anyone. Try again');
    expect(broken).toContain('href="/o/x?choice=ok"');
  });

  it('the header meta: cap usage and hours left, the squares hidden from screen readers', () => {
    const html = renderToStaticMarkup(<OfferMeta model={offerModel('open')} />);
    expect(text(html)).toContain('1 of 2 this month · 71 h left');
    expect(html).toContain('<span class="cap" aria-hidden="true"><i class="is-used"></i><i></i></span>');
  });

  it('no banned words or straight quotes in any state’s copy', () => {
    for (const s of ['open', 'confirm-ok', 'answer', 'ok-sent', 'answer-sent', 'no-done', 'already-acted', 'expired', 'withdrawn', 'paused-member', 'post-failed']) {
      const t = text(render(offerModel(s)));
      for (const re of BANNED_COPY) expect(t, s).not.toMatch(re);
      expect(t, s).not.toMatch(/['"]/);
    }
  });
});

describe('/c: the check-in', () => {
  function ck(state: string, over: Partial<CheckinPageModel> = {}, extra: Record<string, string> = {}): CheckinPageModel {
    const ui = ckUi(parseCheckinQuery({ state, ...extra }, true));
    return {
      nonce: 'n',
      self: '/c/demo',
      mode: 'example',
      ui,
      source: { kind: 'none' },
      other: ui.role === 'member' ? { name: 'Maya Bennett', first: 'Maya' } : { name: 'Priya Shah', first: 'Priya' },
      subject: 'Intro to a hospital procurement lead',
      introMade: { iso: '2026-11-09T21:16:00-08:00', text: 'Nov 9' },
      d14: { iso: '2026-11-23T10:00:00-08:00', text: 'Nov 23' },
      reminder: { iso: '2026-11-13T10:00:00-08:00', text: 'Nov 13' },
      answeredOn: { iso: '2026-11-10T10:00:00-08:00', text: 'Nov 10' },
      closedOn: { iso: '2026-12-09T10:00:00-08:00', text: 'Dec 9' },
      note: '',
      forms: { ref: 'demo', csrf: 'example', mode: 'example', keep: {} },
      justActed: false,
      ...over,
    };
  }
  const renderCk = (m: CheckinPageModel) => renderToStaticMarkup(<CheckinScreen model={m} action={noop} />);

  it('+1 day: the question, 1–5 as one radiogroup with the two outline options, preselected, Save in the row and the bar', () => {
    const html = renderCk(ck('d1-preselected'));
    const t = text(html);
    expect(t).toContain('How useful was the call with Priya?');
    expect(t).toContain('1 2 3 4 5 1 = not at all · 5 = it unblocked me We haven’t talked yet It won’t happen');
    expect(html.match(/role="radio"/g)).toHaveLength(7);
    expect(html).toMatch(/role="radio" aria-checked="true" href="\/c\/demo\?state=d1-preselected&amp;v=4" data-value="4"/);
    expect(html.match(/Save: 4 of 5/g)).toHaveLength(2);
    expect(html).toContain('id="ck-bar"');
    expect(html).toContain('<input type="hidden" name="value" value="4"/>');
  });

  it('member, +14 days and the won’t-happen reasons', () => {
    expect(text(renderCk(ck('member-d1')))).toContain('Was the call with Maya worth your time?');
    const d14 = renderCk(ck('d14-preselected'));
    expect(text(d14)).toContain('What came of the intro to Priya? Unblocked A customer A hire An investor Nothing yet Anything to add? (optional, one line)');
    expect(d14).toMatch(/class="ck-choice"[^>]*>A customer/);
    const wont = text(renderCk(ck('d1-preselected', {}, { v: 'wont' })));
    expect(wont).toContain('Why? Optional. No reply Wrong person Timing');
    expect(wont).toContain('Save: won’t happen');
  });

  it('saved states use the spec’s words', () => {
    expect(text(renderCk(ck('d1-saved')))).toContain('Saved: 4 of 5. This counts as 1 call that happened, rated useful. No names. One more question on Nov 23, then we stop. Change');
    expect(text(renderCk(ck('d1-saved', {}, { v: '2' })))).toContain('rated not useful');
    expect(text(renderCk(ck('d1-notyet')))).toContain('Saved. We’ll ask once more on Nov 13.');
    expect(text(renderCk(ck('d1-wont')))).toContain('Saved. Thanks for telling us.');
    expect(text(renderCk(ck('d1-saved', {}, { who: 'member' })))).toContain('Saved. Thanks. We won’t ask you about this intro again.');
    expect(text(renderCk(ck('d14-saved')))).toContain('Saved. That was the last question about this intro.');
    expect(text(renderCk(ck('already-answered')))).toContain('You answered on Nov 10: 4 of 5.');
    expect(text(renderCk(ck('closed')))).toContain('This check-in closed on Dec 9.');
    expect(text(renderCk(ck('save-failed')))).toContain('Didn’t save. Tap again; nothing is recorded twice.');
  });

  it('SAMPLE says nothing is saved', () => {
    const html = renderCk(ck('d1-saved', { mode: 'sample' }));
    expect(text(html)).toContain('(sample, nothing was saved)');
    expect(text(renderCk(ck('d1-preselected', { mode: 'sample' })))).toContain('Sample Buttons show what happens; nothing is saved.');
  });

  it('invalid and not set up', () => {
    expect(text(renderCk(ck('invalid', { other: null })))).toContain('This link doesn’t match a check-in. It may be mistyped or expired. This site is a demo, so no real offers exist. See a sample check-in ›');
    const unconfigured = ck('d1-preselected', { mode: 'real', forms: null });
    const off = text(renderCk({ ...unconfigured, ui: { ...unconfigured.ui, view: 'unconfigured' } }));
    expect(off).toContain('Check-ins aren’t set up on this instance This instance has no database connected, so this link can’t be looked up. Nothing was sent to anyone. See a sample check-in ›');
    expect(off).not.toContain('broke');
  });
});
