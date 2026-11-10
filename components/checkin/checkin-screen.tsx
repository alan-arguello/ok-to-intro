'use client';

import { startTransition, useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Bar } from '@/components/kit/blocks';
import { Button, ButtonLink } from '@/components/kit/button';
import { SampleTag } from '@/components/kit/pills';
import { Notice } from '@/components/kit/surfaces';
import {
  BROKE_BODY,
  BROKE_TITLE,
  CHECKIN_INVALID_TITLE,
  CHECKIN_OFF_TITLE,
  INVALID_BODY,
  PICK_FIRST,
  SAMPLE_CHECKIN_NOTE,
  SAVE_BROKE,
  SAVE_FAILED,
  UNCONFIGURED_BODY,
} from '@/components/offer/copy';
import { useHydrated } from '@/components/offer/client-hooks';
import { announce } from '@/components/site/live-region';
import { PRODUCT_NAME } from '@/lib/site';
import { checkinQuestion, D1_HELP } from '@/lib/emails';
import {
  answerText,
  checkinHref,
  D14_LABEL,
  D14_VALUES,
  saveLabel,
  WONT_REASONS,
  type CheckinPageModel,
} from './model';
import { useCheckinLive } from './use-checkin-live';

/**
 * The check-in page (/c/[token], ux-spec S5): one question about an intro. GET preselects from the email's link,
 * one POST saves (and the answer can change until the window closes). Options are links, so a no-JS GET can
 * preselect; with JS they are a radiogroup (roving tab stop, arrow keys), keys 1–5 select and Enter saves, only
 * while focus is in the answer group (SC 2.1.4).
 */

type ServerAction = (formData: FormData) => Promise<void>;

export function CheckinScreen({ model, action }: { model: CheckinPageModel; action: ServerAction }) {
  return <CheckinInner key={model.nonce} model={model} action={action} />;
}

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

function visible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function isField(el: Element | null): boolean {
  if (!el) return false;
  const t = el.tagName;
  return t === 'TEXTAREA' || t === 'SELECT' || (t === 'INPUT' && !/^(button|submit|reset|checkbox|radio|hidden)$/i.test((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable;
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function CheckinInner({ model, action }: { model: CheckinPageModel; action: ServerAction }) {
  const ui = model.ui;
  const live = useCheckinLive(model);
  const hydrated = useHydrated();
  const [value, setValue] = useState<string | null>(ui.value);
  const [reason, setReason] = useState(ui.reason);
  const [failed, setFailed] = useState(ui.failed);
  const [busy, setBusy] = useState(false);

  const forms = model.forms;
  const kind = ui.kind;
  const role = ui.role;
  const sample = model.mode === 'sample';
  const exampleRouting = forms?.mode === 'example';
  const cardless = ui.view === 'invalid' || ui.view === 'unconfigured' || ui.view === 'broken';
  const title = live.other ? checkinQuestion(kind, role, live.other.first) : '';
  const fromTab = model.mode === 'sample' && model.source.kind === 'ask' && !live.awaiting;

  // A SAMPLE loop read from the tab names other people than the server knew: keep the document title in step,
  // also when the streamed metadata lands after hydration.
  useEffect(() => {
    if (!fromTab || !title) return;
    const want = `${title} · ${PRODUCT_NAME}`;
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [fromTab, title]);
  const formQa = kind === 'd14' ? 'd14-preselected' : role === 'member' ? 'member-d1' : 'd1-preselected';

  /** The GET that preselects `v` (and `why`) without JS. */
  function optionHref(v: string, why: string | null): string {
    if (!forms) return '#';
    const keep = forms.keep;
    return exampleRouting ? checkinHref(forms.ref, { ...keep, state: formQa, v, why }) : checkinHref(forms.ref, { ...keep, v, why });
  }
  function changeHref(): string {
    if (!forms) return '#';
    if (exampleRouting) return checkinHref(forms.ref, { ...forms.keep, state: formQa, v: ui.value, why: ui.reason });
    return checkinHref(forms.ref, { ...forms.keep, change: '1', v: ui.value, why: ui.reason });
  }

  function select(v: string, why: string | null = v === 'wont' ? reason : null) {
    setValue(v);
    setFailed(null);
    if (v !== 'wont') setReason(null);
    try {
      window.history.replaceState(window.history.state, '', optionHref(v, why));
    } catch {
      /* sandboxed frame */
    }
  }
  function selectReason(r: (typeof WONT_REASONS)[number][0]) {
    setReason(r);
    try {
      window.history.replaceState(window.history.state, '', optionHref('wont', r));
    } catch {
      /* sandboxed frame */
    }
  }

  /** Arrow keys move focus and select inside one radiogroup (port of OTI.radiogroup). */
  function onArrows(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = ARROWS[e.key];
    if (!step) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]'));
    const at = radios.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = radios[(at + step + radios.length) % radios.length] as HTMLElement;
    next.focus();
    next.click();
  }

  /* ---------- keys 1–5 select, Enter saves: only while focus is in the answer group ---------- */

  useEffect(() => {
    if (ui.view !== 'form') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = document.activeElement;
      if (isField(t) || !t || !t.closest('#ck-d1, #ck-d14, #ck-why')) return;
      if (/^[1-5]$/.test(e.key)) {
        const group = document.getElementById(kind === 'd14' ? 'ck-d14' : 'ck-d1');
        const radios = group ? Array.from(group.querySelectorAll<HTMLElement>('[role=radio]')) : [];
        const r = kind === 'd14' ? radios[Number(e.key) - 1] : radios.find((x) => x.dataset.value === e.key);
        if (r) {
          e.preventDefault();
          r.click();
          r.focus();
        }
      } else if (e.key === 'Enter') {
        const b = Array.from(document.querySelectorAll<HTMLElement>('[data-save]')).find(visible);
        e.preventDefault();
        if (b && b.getAttribute('aria-disabled') !== 'true') b.click();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ui.view, kind]);

  /* ---------- on arrival: focus and one announcement ---------- */

  useEffect(() => {
    if (ui.view === 'form' && (model.ui.failed || (forms && forms.keep.change))) {
      document.querySelector<HTMLElement>('#ck-d1 [aria-checked="true"], #ck-d14 [aria-checked="true"]')?.focus();
    }
    if (ui.view !== 'form') {
      const head = document.getElementById('ck-done-h') ?? document.querySelector<HTMLElement>('.ck-invalid .title');
      if (head) {
        if (model.justActed) head.focus();
        announce(head.textContent ?? '');
      }
    }
    if (ui.failed) announce(ui.failed === 'server' ? SAVE_BROKE : ui.failed === 'input' ? PICK_FIRST : SAVE_FAILED);
    // Once per server render (keyed by its nonce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- the one POST ---------- */

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // nothing is recorded twice
    if (!value) {
      document.querySelector<HTMLElement>('#ck-d1 [role=radio], #ck-d14 [role=radio]')?.focus();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailed('client');
      announce(SAVE_FAILED);
      return;
    }
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setFailed(null);
    startTransition(async () => {
      try {
        await action(fd);
      } catch (err) {
        if (isRedirect(err)) return;
        setBusy(false);
        setFailed('client');
        announce(SAVE_FAILED);
      }
    });
  }

  /* ---------- pieces ---------- */

  function option(v: string, label: ReactNode, className: string | undefined, current: string | null, tabStop: boolean, onPick: (v: string) => void, why: string | null = null) {
    return (
      <a
        key={v}
        role="radio"
        aria-checked={current === v}
        tabIndex={hydrated ? (tabStop ? 0 : -1) : undefined}
        href={optionHref(why ? 'wont' : v, why ?? (v === 'wont' ? reason : null))}
        data-value={v}
        className={className}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          onPick(v);
        }}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            onPick(v);
          }
        }}
      >
        {label}
      </a>
    );
  }

  const errLine = failed ? <p className="error-text ck-err">{failed === 'server' ? SAVE_BROKE : failed === 'input' ? PICK_FIRST : SAVE_FAILED}</p> : null;
  const label = saveLabel(kind, value);
  const d1Values = ['1', '2', '3', '4', '5', 'notyet', 'wont'];
  const d1Stop = value && d1Values.includes(value) ? value : '1';
  const d14Stop = value && (D14_VALUES as readonly string[]).includes(value) ? value : D14_VALUES[0];
  const whyStop = reason ?? WONT_REASONS[0][0];

  let result: ReactNode = null;
  if (cardless) {
    const unconfigured = ui.view === 'unconfigured';
    const broken = ui.view === 'broken';
    result = (
      <div className="ck-invalid">
        <h1 className="title">{broken ? BROKE_TITLE : unconfigured ? CHECKIN_OFF_TITLE : CHECKIN_INVALID_TITLE}</h1>
        <p className="ck-done__body">{broken ? BROKE_BODY : unconfigured ? UNCONFIGURED_BODY : INVALID_BODY}</p>
        <div className="btn-row">
          {broken ? (
            <a className="btn btn--primary btn--lg" href={model.self} data-primary="">
              Try again
            </a>
          ) : unconfigured ? (
            <ButtonLink variant="primary" size="lg" href="/c/sample" primary>
              See a sample check-in ›
            </ButtonLink>
          ) : (
            <ButtonLink variant="primary" size="lg" href="/c/sample" primary>
              See a sample check-in ›
            </ButtonLink>
          )}
        </div>
      </div>
    );
  } else if (ui.view !== 'form') {
    const tag = sample ? (
      <>
        <SampleTag className="offer-done__tag" />{' '}
      </>
    ) : null;
    const change = (primary: boolean) => (
      <div className="btn-row">
        <ButtonLink href={changeHref()} primary={primary} data-change="">
          Change
        </ButtonLink>
      </div>
    );
    const card = (head: ReactNode, body: ReactNode, extra: ReactNode, actions: ReactNode) => (
      <section className="card ck-done" aria-labelledby="ck-done-h">
        <p className="ck-done__head" id="ck-done-h" tabIndex={-1}>
          {tag}
          {head}
        </p>
        {body ? <p className="ck-done__body">{body}</p> : null}
        {extra}
        {actions}
      </section>
    );
    const v = ui.value;
    if (ui.view === 'saved') {
      if (kind === 'd14') result = card('Saved.', 'That was the last question about this intro.', null, change(false));
      else if (v === 'notyet') result = card('Saved.', <>We’ll ask once more on {live.reminder}.</>, null, change(false));
      else if (role === 'member') result = card('Saved.', 'Thanks. We won’t ask you about this intro again.', null, change(false));
      else if (v === 'wont') result = card('Saved.', 'Thanks for telling us.', null, change(false));
      else {
        const n = Number(v);
        const useful = n >= 4 ? 'rated useful' : 'rated not useful';
        result = card(
          `Saved: ${n} of 5.`,
          sample ? (
            `A real check-in counts as 1 call that happened, ${useful}. No names. (sample, nothing was saved)`
          ) : (
            `This counts as 1 call that happened, ${useful}. No names.`
          ),
          <p className="meta">One more question on {live.d14}, then we stop.</p>,
          change(false),
        );
      }
    } else if (ui.view === 'already') {
      result = card(
        <>
          You answered on {live.answeredOn}: {answerText(kind, v)}.
        </>,
        null,
        null,
        change(true),
      );
    } else if (ui.view === 'closed') {
      result = card(<>This check-in closed on {live.closedOn}.</>, null, null, null);
    }
  }

  // The POST carries the kind and role once (below); the kept query only adds the loop's ask and `change`.
  const hiddenFields = forms ? (
    <>
      <input type="hidden" name="ref" value={forms.ref} />
      <input type="hidden" name="csrf" value={forms.csrf} />
      <input type="hidden" name="mode" value={forms.mode} />
      {Object.entries(forms.keep)
        .filter(([k]) => k !== 'kind' && k !== 'who' && k !== 'role')
        .map(([k, val]) => (
          <input key={k} type="hidden" name={k} value={val} />
        ))}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="value" value={value ?? ''} />
      <input type="hidden" name="reason" value={value === 'wont' ? (reason ?? '') : ''} />
    </>
  ) : null;

  return (
    <>
      {!cardless ? (
        <h1 className="title" id="ck-q" data-await-store={live.awaiting ? '' : undefined}>
          {title}
        </h1>
      ) : null}
      <div id="ck-result">{result}</div>

      {ui.view === 'form' && forms ? (
        <>
          <form className="ck-form" id="ck-form" action={action} onSubmit={onSave}>
            {hiddenFields}
            {kind === 'd1' ? (
              <>
                <div className="ck-group" id="ck-d1" role="radiogroup" aria-labelledby="ck-q" aria-describedby="ck-scale-help" onKeyDown={onArrows}>
                  <div className="seg ck-scale">{['1', '2', '3', '4', '5'].map((n) => option(n, n, undefined, value, d1Stop === n, select))}</div>
                  <p className="help" id="ck-scale-help">
                    {D1_HELP}
                  </p>
                  <div className="ck-alt">
                    {option('notyet', 'We haven’t talked yet', 'btn ck-opt', value, d1Stop === 'notyet', select)}
                    {option('wont', 'It won’t happen', 'btn ck-opt', value, d1Stop === 'wont', select)}
                  </div>
                </div>
                {value === 'wont' ? (
                  <div className="ck-why" id="ck-why">
                    <p className="label" id="ck-why-l">
                      Why? Optional.
                    </p>
                    <div className="chips" role="radiogroup" aria-labelledby="ck-why-l" id="ck-why-g" onKeyDown={onArrows}>
                      {WONT_REASONS.map(([r, text]) => option(r, text, 'chip', reason, whyStop === r, () => selectReason(r), r))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="ck-group ck-choices" id="ck-d14" role="radiogroup" aria-labelledby="ck-q" onKeyDown={onArrows}>
                  {D14_VALUES.map((o) => option(o, D14_LABEL[o], 'ck-choice', value, d14Stop === o, select))}
                </div>
                <div className="field" id="ck-note-f">
                  <label className="label" htmlFor="ck-note">
                    Anything to add? (optional, one line)
                  </label>
                  <input className="input" id="ck-note" name="note" maxLength={140} autoComplete="off" defaultValue={model.note} />
                </div>
              </>
            )}
            {sample ? (
              <Notice className="ck-sample">
                <SampleTag /> {SAMPLE_CHECKIN_NOTE}
              </Notice>
            ) : null}
            <div className="ck-save hide-phone" id="ck-desk">
              <Button variant="primary" size="lg" type="submit" data-save="" primary busy={busy} aria-disabled={value ? undefined : true}>
                {label}
              </Button>
              {errLine}
            </div>
          </form>
          <Bar id="ck-bar">
            <Button variant="primary" size="lg" block type="submit" form="ck-form" data-save="" primary busy={busy} aria-disabled={value ? undefined : true}>
              {label}
            </Button>
            {errLine}
          </Bar>
        </>
      ) : null}
    </>
  );
}
