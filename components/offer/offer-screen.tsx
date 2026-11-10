'use client';

import { startTransition, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Bar, Diff } from '@/components/kit/blocks';
import { Button, ButtonLink } from '@/components/kit/button';
import { Mark } from '@/components/kit/clause';
import { Counter, ErrorText, Field, Help, Input, Label, LabelRow, Textarea } from '@/components/kit/forms';
import { OfferCard } from '@/components/kit/offer-card';
import { Cap, SampleTag } from '@/components/kit/pills';
import { Notice } from '@/components/kit/surfaces';
import { announce } from '@/components/site/live-region';
import { writeStore } from '@/lib/oti/storage';
import { q, upper1 } from '@/lib/oti/text';
import { PRODUCT_NAME } from '@/lib/site';
import type { OfferAction } from '@/lib/types';
import { useLocalTime } from './client-hooks';
import {
  ANSWER_HELP,
  ANSWER_LABEL,
  ANSWER_TOO_LONG,
  BROKE_BODY,
  BROKE_TITLE,
  CAP_LOWERED,
  FOLLOW_BROKE,
  INVALID_BODY,
  KEPT_RULES,
  LOOP_EDIT_NOTE,
  NO_EDIT,
  NOTE_SAVED,
  OFFER_INVALID_TITLE,
  OFFER_OFF_TITLE,
  OTHER_HELP,
  POST_BROKE,
  POST_FAILED,
  SAMPLE_OFFER_NOTE,
  SUGGESTED_CHANGE,
  TWO_BREAKS,
  UNCONFIGURED_BODY,
  VAGUE_THANKS,
  WHY_LABEL,
} from './copy';
import {
  ANSWER_MAX,
  CARDLESS_VIEWS,
  capText,
  clampAnswerLines,
  exampleHref,
  fineText,
  isDoneView,
  NOTE_MAX,
  offerHref,
  resultHref,
  WHY_OPTIONS,
  type OfferCardModel,
  type OfferPageModel,
  type OfferScreenView,
  type TimeLabel,
  type WhyKey,
  type WhyStep,
} from './model';
import { useOfferCard } from './use-offer-card';

/**
 * The offer page (/o/[token], ux-spec S4): a recipient-first card, then one decision. GET renders and never changes
 * anything; every change is a form POST to a server action (CSRF + Origin check, idempotent, 303 to the result),
 * so the page works with JS off. With JS, OK and Answer open in place (the URL follows), POSTs show their busy
 * state, a dropped connection says so, and keys 1/2/3 move focus inside the action row (SC 2.1.4).
 */

type ServerAction = (formData: FormData) => Promise<void>;

export interface OfferActions {
  respond: ServerAction;
  reason: ServerAction;
  follow: ServerAction;
}

/** Remounts on every server render, so state starts fresh after a POST lands. */
export function OfferScreen({ model, actions }: { model: OfferPageModel; actions: OfferActions }) {
  return <OfferScreenInner key={model.nonce} model={model} actions={actions} />;
}

const DRAFT_KEY = 'oti.r.answer';
const noSubscribe = () => () => undefined;

function readDraft(offerId: string): string {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null') as { v?: number; offer?: string; text?: string } | null;
    return v && v.v === 1 && v.offer === offerId && typeof v.text === 'string' ? v.text : '';
  } catch {
    return '';
  }
}

function writeDraft(offerId: string, text: string): void {
  try {
    if (text) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, offer: offerId, text }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: the answer just isn't kept across a failed POST */
  }
}

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

function visible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function firstVisible(selector: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible) ?? null;
}

function isField(el: Element | null): boolean {
  if (!el) return false;
  const t = el.tagName;
  if ((el as HTMLElement).isContentEditable || t === 'TEXTAREA' || t === 'SELECT') return true;
  return t === 'INPUT' && !/^(button|submit|reset|checkbox|radio|hidden|range|color|file|image)$/i.test((el as HTMLInputElement).type);
}

function focusEl(el: HTMLElement | null) {
  if (!el) return;
  try {
    el.focus({ preventScroll: false });
  } catch {
    el.focus();
  }
}

/** A time in the viewer's zone (network time without JS). */
function When({ t, format }: { t: TimeLabel | null; format: 'weekday-at' | 'weekday' | 'clock' }) {
  const text = useLocalTime(t?.iso ?? null, format, t?.text ?? '');
  return t ? <time dateTime={t.iso}>{text}</time> : null;
}

function OfferScreenInner({ model, actions }: { model: OfferPageModel; actions: OfferActions }) {
  const live = useOfferCard(model);
  const { card, askId } = live;
  const forms = model.forms;
  const ui = model.ui;

  const [view, setView] = useState<OfferScreenView>(ui.view);
  const [nohint, setNohint] = useState(ui.nohint);
  const [failed, setFailed] = useState(ui.failed);
  const [busy, setBusy] = useState<string | null>(null);
  const offerId = forms?.offerId ?? 'none';
  const restored = useSyncExternalStore(
    noSubscribe,
    () => readDraft(offerId),
    () => '',
  );
  const [typed, setTyped] = useState<string | null>(null);
  const answer = typed ?? restored;
  const textRef = useRef<HTMLTextAreaElement>(null);

  const done = isDoneView(view);
  const sample = model.mode === 'sample';
  const exampleRouting = forms?.mode === 'example';
  const who = card?.who ?? '';
  const Who = upper1(who);

  /* ---------- URLs ---------- */

  const self = forms ? offerHref(forms.ref) : '';
  /** The GET query for an open view (the email's choice), keeping the SAMPLE loop or the QA state. */
  function viewQuery(v: 'open' | 'confirm' | 'answer'): Record<string, string> {
    const keep = forms?.keep ?? {};
    if (exampleRouting) return { ...keep, state: v === 'confirm' ? 'confirm-ok' : v === 'answer' ? 'answer' : 'open' };
    return { ...keep, ...(v === 'confirm' ? { choice: 'ok' } : v === 'answer' ? { choice: 'answer' } : {}) };
  }
  function resultUrl(r: { why?: WhyKey | null; step?: WhyStep | null }): string {
    if (!forms) return '';
    return exampleRouting ? exampleHref(forms.ref, { done: 'no', ...r }) : resultHref(forms.ref, forms.keep, { done: 'no', ...r });
  }

  /* ---------- open ↔ confirm ↔ answer, in place ---------- */

  function show(next: 'open' | 'confirm' | 'answer', focus: 'send' | 'text' | 'ok' | 'answer' | null) {
    setView(next);
    setFailed(null);
    setNohint(false);
    try {
      window.history.replaceState(window.history.state, '', offerHref(forms?.ref ?? '', viewQuery(next)));
    } catch {
      /* sandboxed frame */
    }
    if (focus) {
      // After React commits the new view.
      requestAnimationFrame(() => {
        if (focus === 'text') focusEl(textRef.current);
        else if (focus === 'send') focusEl(firstVisible('[data-send]'));
        else focusEl(firstVisible(`[data-key="${focus}"]`));
      });
    }
  }

  /** The GET forms (OK to intro, Answer in 2 lines, Back) open in place with JS; without JS they load `?choice=`. */
  function onGet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = (e.currentTarget.dataset.view ?? 'open') as 'open' | 'confirm' | 'answer';
    show(next, next === 'confirm' ? 'send' : next === 'answer' ? 'text' : view === 'answer' ? 'answer' : 'ok');
  }

  /* ---------- POSTs ---------- */

  /**
   * Every POST on the page (`data-act`): one at a time, so nothing happens twice; offline or a dropped connection
   * says so and keeps what was typed. SAMPLE also tells /ask/[id] what the visitor did (oti.sampleOffer).
   */
  function onPost(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const act = form.dataset.act ?? '';
    const respond = act === 'ok' || act === 'no' || act === 'answer';
    const call = act === 'reason' ? actions.reason : respond ? actions.respond : actions.follow;
    const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter ?? undefined);
    if (act === 'answer' && !answer.trim()) {
      focusEl(document.getElementById('offer-text'));
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailed('client');
      announce(POST_FAILED);
      return;
    }
    if (sample && respond) writeStore('sampleOffer', { v: 1, ask_id: askId ?? 'sample', action: act as OfferAction, at: Date.now(), text: act === 'answer' ? answer.trim() : null });
    setBusy(act);
    setFailed(null);
    startTransition(async () => {
      try {
        await call(fd);
      } catch (err) {
        if (isRedirect(err)) return; // the router is already on its way to the result
        setBusy(null);
        setFailed('client');
        announce(POST_FAILED);
      }
    });
  }

  /* ---------- keys 1/2/3: move focus inside the action row only (SC 2.1.4); Enter or a tap acts ---------- */

  useEffect(() => {
    if (view !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const a = document.activeElement;
      if (!a || isField(a) || !a.closest('#offer-desk, #offer-bar')) return;
      const k = ({ '1': 'ok', '2': 'answer', '3': 'no' } as Record<string, string>)[e.key];
      const b = k ? firstVisible(`[data-key="${k}"]`) : null;
      if (b) {
        e.preventDefault();
        b.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);

  /* ---------- on arrival: focus and one announcement ---------- */

  useEffect(() => {
    const v = ui.view;
    if (v === 'answer-sent') writeDraft(offerId, '');
    if (v === 'answer') focusEl(textRef.current);
    else if (ui.nohint) focusEl(firstVisible('[data-key="no"]'));
    if (isDoneView(v)) {
      const head = document.getElementById('offer-done-h') ?? document.querySelector<HTMLElement>('.offer-invalid .title');
      const out = document.getElementById('offer-why-out');
      if (model.justActed && ui.why && ui.step === 'applied') focusEl(document.querySelector<HTMLElement>('[data-why="undo"]'));
      else if (model.justActed && ui.why && ui.step === 'undone') focusEl(document.querySelector<HTMLElement>('[data-why="add"]') ?? out);
      else if (model.justActed && ui.why && ui.step) focusEl(out);
      else if (model.justActed && ui.why) focusEl(document.querySelector<HTMLElement>(`#offer-why-g [data-value="${ui.why}"]`));
      else if (model.justActed && head) focusEl(head);
      // One announcement: what the last tap did (prototype b.js).
      if (ui.step === 'undone') announce(model.base ? 'Back to version 3.' : 'Removed the line.');
      else if (model.justActed && ui.why && ui.step && out) announce((out.textContent ?? '').replace(/\s*Undo$/, ''));
      else if (head && !ui.why) announce(head.textContent ?? '');
    }
    if (ui.failed) announce(ui.failed === 'input' ? ANSWER_TOO_LONG : ui.failed === 'server' ? POST_BROKE : POST_FAILED);
    // Once per server render (the component is keyed by the render's nonce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The tab's own ask can differ from what the server knew: keep the document title in step with the card, also
  // when the streamed metadata lands after hydration.
  useEffect(() => {
    if (!card || !live.askId || CARDLESS_VIEWS.includes(view)) return;
    const want = `${card.title} · ${PRODUCT_NAME}`;
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [card, live.askId, view]);

  /* ---------- pieces ---------- */

  const hidden = forms ? (
    <>
      <input type="hidden" name="ref" value={forms.ref} />
      <input type="hidden" name="csrf" value={forms.csrf} />
      <input type="hidden" name="mode" value={forms.mode} />
      {Object.entries(forms.keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  ) : null;

  // A POST that didn't go through says so next to the buttons; an answer the server refused says so under the field.
  const errLine = failed && failed !== 'input' && !done ? <p className="error-text offer-err">{failed === 'client' ? POST_FAILED : POST_BROKE}</p> : null;
  const inputErr = failed === 'input' && view === 'answer';
  const confirmQ = `Send the intro email to you and ${who}?`;
  const noHint = `One tap on No passes. ${Who} won’t be told.`;
  const empty = !answer.trim();

  const okBtn = (block: boolean) => (
    <Button variant="ok" size="lg" block={block} type="submit" form="offer-g-ok" data-key="ok" aria-keyshortcuts="1" primary={!nohint}>
      OK to intro
    </Button>
  );
  const ansBtn = (cls?: string) => (
    <Button size={cls ? 'md' : 'lg'} className={cls} type="submit" form="offer-g-answer" data-key="answer" aria-keyshortcuts="2">
      Answer in 2 lines
    </Button>
  );
  const noBtn = (cls?: string) => (
    <Button size={cls ? 'md' : 'lg'} className={cls} type="submit" form="offer-f-no" data-key="no" aria-keyshortcuts="3" primary={nohint} busy={busy === 'no'}>
      No
    </Button>
  );
  const sendIntro = (block: boolean) => (
    <Button variant="ok" size="lg" block={block} type="submit" form="offer-f-ok" data-send="" primary busy={busy === 'ok'}>
      Send intro
    </Button>
  );
  const sendAnswer = () => (
    <Button variant="primary" size="lg" type="submit" form="offer-f-answer" data-send="" primary busy={busy === 'answer'} aria-disabled={empty ? true : undefined}>
      Send answer
    </Button>
  );
  const back = (cls: 'lg' | 'block') => (
    <Button variant="ghost" size={cls === 'lg' ? 'lg' : 'md'} block={cls === 'block'} type="submit" form="offer-g-back" data-back="">
      Back
    </Button>
  );

  let desk: ReactNode = null;
  let bar: ReactNode = null;
  if (!done && forms) {
    if (view === 'confirm') {
      desk = (
        <>
          <p className="offer-q">{confirmQ}</p>
          <div className="btn-row">
            {sendIntro(false)}
            {back('lg')}
          </div>
          {errLine}
        </>
      );
      bar = (
        <>
          <p className="bar__text offer-bar__q">{confirmQ}</p>
          {sendIntro(true)}
          {back('block')}
          {errLine}
        </>
      );
    } else if (view === 'answer') {
      desk = (
        <>
          <div className="btn-row">
            {sendAnswer()}
            {back('lg')}
          </div>
          {errLine}
        </>
      );
      bar = (
        <>
          <div className="btn-row offer-bar__answer">
            {back('lg')}
            {sendAnswer()}
          </div>
          {errLine}
        </>
      );
    } else {
      desk = (
        <>
          {nohint ? <p className="offer-q">{noHint}</p> : null}
          <div className="btn-row">
            {okBtn(false)}
            {ansBtn()}
            {noBtn()}
          </div>
          {errLine}
        </>
      );
      bar = (
        <>
          {nohint ? <p className="bar__text offer-bar__q">{noHint}</p> : null}
          {okBtn(true)}
          <div className="btn-row">
            {ansBtn('offer-bar__btn')}
            {noBtn('offer-bar__btn')}
          </div>
          {errLine}
        </>
      );
    }
  }

  return (
    <>
      <div className="offer-top" id="offer-top">
        {!done && ui.paused && model.pausedUntil ? (
          <Notice>Your asks are paused until {model.pausedUntil}. This one arrived before you paused; you can still answer it.</Notice>
        ) : null}
        {done ? (
          <Result model={model} view={view} card={card} askId={askId} actions={actions} hidden={hidden} busy={busy} failed={failed} onPost={onPost} resultUrl={resultUrl} />
        ) : null}
      </div>

      {card && !['invalid', 'unconfigured', 'broken'].includes(view) ? (
        <div id="offer-ask" data-await-store={live.awaiting ? '' : undefined}>
          <OfferCard
            titleAs="h1"
            titleId="offer-title"
            title={card.title}
            from={card.from}
            match={
              card.matched ? (
                <>
                  Matched your rule: <Mark>{q(card.matched)}</Mark>
                </>
              ) : (
                'Matched your rules.'
              )
            }
            fine={fineText(card)}
            facts={card.facts}
          />
        </div>
      ) : null}

      <div className="offer-after">
        {!done && sample ? (
          <Notice className="offer-sample">
            <SampleTag /> {SAMPLE_OFFER_NOTE}
          </Notice>
        ) : null}
      </div>

      {!done && forms ? (
        <>
          <form className="offer-compose" id="offer-f-answer" data-act="answer" action={actions.respond} onSubmit={onPost} hidden={view !== 'answer'}>
            {hidden}
            <input type="hidden" name="action" value="answer" />
            <Field>
              <LabelRow>
                <Label htmlFor="offer-text">{ANSWER_LABEL}</Label>
                <Counter id="offer-count">
                  {answer.length} / {ANSWER_MAX}
                </Counter>
              </LabelRow>
              <Textarea
                ref={textRef}
                id="offer-text"
                name="text"
                maxLength={ANSWER_MAX}
                rows={3}
                required
                aria-describedby={inputErr ? 'offer-text-err offer-count offer-help' : 'offer-count offer-help'}
                invalid={inputErr}
                value={answer}
                onChange={(e) => {
                  const v = clampAnswerLines(e.target.value);
                  setTyped(v);
                  writeDraft(offerId, v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && (answer.match(/\n/g) || []).length >= 2) {
                    e.preventDefault();
                    announce(TWO_BREAKS);
                  }
                }}
              />
              <Help id="offer-help">{ANSWER_HELP}</Help>
              {inputErr ? <ErrorText id="offer-text-err">{ANSWER_TOO_LONG}</ErrorText> : null}
            </Field>
          </form>

          <div className="offer-desk hide-phone" id="offer-desk">
            {desk}
          </div>

          {/* GET renders (the email's choice); every change is a POST with CSRF and a server-side idempotency key. */}
          <form id="offer-g-ok" data-view="confirm" method="get" action={self} onSubmit={onGet}>
            {Object.entries(viewQuery('confirm')).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
          <form id="offer-g-answer" data-view="answer" method="get" action={self} onSubmit={onGet}>
            {Object.entries(viewQuery('answer')).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
          <form id="offer-g-back" data-view="open" method="get" action={self} onSubmit={onGet}>
            {Object.entries(viewQuery('open')).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
          <form id="offer-f-ok" data-act="ok" action={actions.respond} onSubmit={onPost}>
            {hidden}
            <input type="hidden" name="action" value="ok" />
          </form>
          <form id="offer-f-no" data-act="no" action={actions.respond} onSubmit={onPost}>
            {hidden}
            <input type="hidden" name="action" value="no" />
          </form>

          <Bar stack id="offer-bar">
            {bar}
          </Bar>
        </>
      ) : null}
    </>
  );
}

/* ======================================================================== *
 * Results: the first sentence of the spec copy is the panel head, the rest follows word for word
 * ======================================================================== */

interface ResultProps {
  model: OfferPageModel;
  view: OfferScreenView;
  card: OfferCardModel | null;
  askId: string | null;
  actions: OfferActions;
  hidden: ReactNode;
  busy: string | null;
  failed: OfferPageModel['ui']['failed'];
  onPost: (e: FormEvent<HTMLFormElement>) => void;
  resultUrl: (r: { why?: WhyKey | null; step?: WhyStep | null }) => string;
}

function Result({ model, view, card, askId, actions, hidden, busy, failed, onPost, resultUrl }: ResultProps) {
  const sample = model.mode === 'sample';
  if (view === 'invalid' || view === 'unconfigured' || view === 'broken') {
    const title = view === 'broken' ? BROKE_TITLE : view === 'unconfigured' ? OFFER_OFF_TITLE : OFFER_INVALID_TITLE;
    const body = view === 'broken' ? BROKE_BODY : view === 'unconfigured' ? UNCONFIGURED_BODY : INVALID_BODY;
    return (
      <div className="offer-invalid">
        <h1 className="title">{title}</h1>
        <p className="offer-done__body">{body}</p>
        <div className="btn-row">
          {view === 'broken' ? (
            <a className="btn btn--primary btn--lg" href={model.self} data-primary="">
              Try again
            </a>
          ) : view === 'unconfigured' ? (
            <ButtonLink variant="primary" size="lg" href="/o/sample" primary>
              See a sample offer ›
            </ButtonLink>
          ) : (
            <ButtonLink variant="primary" size="lg" href="/o/sample" primary>
              See a sample offer ›
            </ButtonLink>
          )}
        </div>
      </div>
    );
  }
  if (!card) return null;

  const who = card.who;
  const Who = upper1(who);
  const cap = capText(card);
  const source = model.source;
  // SAMPLE: back to the ask that was sent (S2), or to the playground; otherwise the rules page.
  const nextLink = sample
    ? source.kind === 'ask' && askId
      ? { href: `/ask/${encodeURIComponent(askId)}`, label: 'Back to your ask ›' }
      : { href: '/rules', label: 'Back to the playground ›' }
    : { href: '/rules', label: 'Be asked ›' };
  const addOffered = view === 'no' && (model.ui.why === 'area' || model.ui.why === 'stage') && !!model.edit && model.ui.step !== 'applied' && model.ui.step !== 'kept';
  const next = (
    <ButtonLink href={nextLink.href} primary={!addOffered}>
      {nextLink.label}
    </ButtonLink>
  );
  const capRow = (
    <p className="meta offer-done__cap">
      <Cap cap={card.cap} used={card.nth} hidden />
      <span>This used {cap}.</span>
    </p>
  );
  const tag = sample ? (
    <>
      <SampleTag className="offer-done__tag" />{' '}
    </>
  ) : null;

  let head: ReactNode = null;
  let body: ReactNode = null;
  let extra: ReactNode = null;
  let links: ReactNode = next;
  let after: ReactNode = null;

  if (view === 'ok-sent') {
    extra = capRow;
    if (sample) {
      head = 'Intro sent (sample, no email sent).';
      links = (
        <>
          <ButtonLink variant="primary" href={askId ? `/emails/intro?ask=${encodeURIComponent(askId)}` : '/emails/intro'} primary>
            See the intro email ›
          </ButtonLink>
          <ButtonLink href={nextLink.href}>{nextLink.label}</ButtonLink>
        </>
      );
    } else {
      head = 'Intro sent.';
      body = (
        <>
          We emailed you and {who} at <When t={model.okAt} format="clock" />
          {model.scheduling ? ', with your scheduling link' : ''}. Reply-all to pick a time. Tomorrow we’ll ask you both one question: did the call happen?
        </>
      );
    }
  } else if (view === 'answer-sent') {
    head = sample ? 'Sent (sample, no email sent).' : 'Sent.';
    body = `${Who} gets your 2 lines without your name. This used ${cap}.`;
  } else if (view === 'no') {
    head = 'Passed.';
    body = `${Who} won’t be told. It goes to the next person whose rules accepted it. This still counts as ${cap}.`;
    after = <Why model={model} hidden={hidden} busy={busy} failed={failed} onPost={onPost} resultUrl={resultUrl} actions={actions} />;
  } else if (view === 'already-acted') {
    const did = model.ui.did;
    head = (
      <>
        {did === 'no' ? 'You passed on ' : did === 'answer' ? 'You answered on ' : 'You said OK on '}
        <When t={model.acted} format="weekday-at" />.
      </>
    );
    body = did === 'ok' ? 'The intro email went to you both.' : null;
  } else if (view === 'expired') {
    head = (
      <>
        This ask went to the next person on <When t={model.expiredAt} format="weekday-at" />, after 72 hours without a reply.
      </>
    );
    body = `${Who} wasn’t told it reached you. It still counted as ${cap}.`;
  } else if (view === 'withdrawn') {
    head = (
      <>
        {Who} withdrew this ask on <When t={model.withdrawnOn} format="weekday" />.
      </>
    );
    body = `Nothing to do. It still counted as ${cap}.`;
  }

  return (
    <section className="card offer-done" aria-labelledby="offer-done-h">
      <p className="offer-done__head" id="offer-done-h" tabIndex={-1}>
        {tag}
        {head}
      </p>
      {body ? <p className="offer-done__body">{body}</p> : null}
      {extra}
      <div className="btn-row offer-done__links">{links}</div>
      {after}
    </section>
  );
}

/* ======================================================================== *
 * No → an optional private reason → the matching fix: a templated rule edit, a lower cap or a pause, or feedback
 * ======================================================================== */

interface WhyProps {
  model: OfferPageModel;
  hidden: ReactNode;
  busy: string | null;
  failed: OfferPageModel['ui']['failed'];
  actions: OfferActions;
  onPost: (e: FormEvent<HTMLFormElement>) => void;
  resultUrl: (r: { why?: WhyKey | null; step?: WhyStep | null }) => string;
}

function Why({ model, hidden, busy, failed, actions, onPost, resultUrl }: WhyProps) {
  const { why, step } = model.ui;
  const [note, setNote] = useState('');
  const followForm = (id: string, s: 'add' | 'undo' | 'cap' | 'pause') => (
    <form id={id} data-act={s} action={actions.follow} onSubmit={onPost} hidden>
      {hidden}
      <input type="hidden" name="step" value={s} />
      <input type="hidden" name="why" value={why ?? ''} />
    </form>
  );

  let out: ReactNode = null;
  if (why === 'area' || why === 'stage') {
    if (step === 'applied') {
      out = (
        <p className="small">
          Rules updated, version {model.rulesVersion ?? 1}.{' '}
          <Button variant="ghost" size="sm" type="submit" form="offer-f-undo" data-why="undo" busy={busy === 'undo'}>
            Undo
          </Button>
        </p>
      );
    } else if (step === 'kept') {
      out = <p className="small">{KEPT_RULES}</p>;
    } else if (model.edit) {
      out = (
        <>
          <p className="label">{SUGGESTED_CHANGE}</p>
          <Diff
            label={SUGGESTED_CHANGE}
            lines={[...(model.edit.context ? [{ kind: 'ctx' as const, text: model.edit.context }] : []), { kind: 'add' as const, text: model.edit.add }]}
          />
          <p className="help">{model.edit.caption}</p>
          <div className="btn-row">
            <Button variant="primary" type="submit" form="offer-f-add" data-why="add" primary busy={busy === 'add'}>
              Add to my rules
            </Button>
            <ButtonLink variant="ghost" href={resultUrl({ why, step: 'kept' })} data-why="keep">
              Keep my rules
            </ButtonLink>
          </div>
        </>
      );
    } else {
      out = <p className="small">{model.mode === 'sample' && !model.base ? LOOP_EDIT_NOTE : NO_EDIT}</p>;
    }
  } else if (why === 'busy') {
    out =
      step === 'cap' ? (
        <p className="small">{CAP_LOWERED}</p>
      ) : step === 'pause' ? (
        <p className="small">Paused until {model.pauseUntil}. Offers go to others.</p>
      ) : (
        <div className="btn-row">
          <Button type="submit" form="offer-f-cap" data-why="cap" busy={busy === 'cap'}>
            Lower my cap to 1
          </Button>
          <Button type="submit" form="offer-f-pause" data-why="pause" busy={busy === 'pause'}>
            Pause until {model.pauseUntil}
          </Button>
        </div>
      );
  } else if (why === 'vague') {
    out = <p className="small">{VAGUE_THANKS}</p>;
  } else if (why === 'other') {
    out =
      step === 'saved' ? (
        <p className="small">{NOTE_SAVED}</p>
      ) : (
        <form className="offer-why__note" id="offer-f-note" data-act="note" action={actions.follow} onSubmit={onPost}>
          {hidden}
          <input type="hidden" name="step" value="note" />
          <input type="hidden" name="why" value="other" />
          <Field>
            <LabelRow>
              <Label htmlFor="offer-other">Your reason</Label>
              <Counter id="offer-other-c">
                {note.length} / {NOTE_MAX}
              </Counter>
            </LabelRow>
            <Input id="offer-other" name="note" maxLength={NOTE_MAX} autoComplete="off" required aria-describedby="offer-other-c offer-other-h" value={note} onChange={(e) => setNote(e.target.value)} />
            <Help id="offer-other-h">{OTHER_HELP}</Help>
          </Field>
          <div className="btn-row">
            <Button type="submit" busy={busy === 'note'}>
              Save
            </Button>
          </div>
        </form>
      );
  }

  return (
    <div className="offer-why">
      <p className="label" id="offer-why-l">
        {WHY_LABEL}
      </p>
      <form className="chips" role="group" aria-labelledby="offer-why-l" id="offer-why-g" data-act="reason" action={actions.reason} onSubmit={onPost}>
        {hidden}
        {WHY_OPTIONS.map(([k, label]) => (
          <button key={k} className="chip" type="submit" name="why" value={k} aria-pressed={why === k} data-value={k}>
            {label}
          </button>
        ))}
      </form>
      <div className="offer-why__out" id="offer-why-out" tabIndex={-1}>
        {out}
        {failed && why ? <p className="error-text offer-err">{failed === 'client' ? POST_FAILED : FOLLOW_BROKE}</p> : null}
      </div>
      {why === 'area' || why === 'stage' ? (
        <>
          {followForm('offer-f-add', 'add')}
          {followForm('offer-f-undo', 'undo')}
        </>
      ) : null}
      {why === 'busy' ? (
        <>
          {followForm('offer-f-cap', 'cap')}
          {followForm('offer-f-pause', 'pause')}
        </>
      ) : null}
    </div>
  );
}
