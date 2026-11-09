'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { sendCode, verifyCode } from '@/app/(site)/join/actions';
import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { CodeInput, Field, Input, Label } from '@/components/kit/forms';
import { Card, Notice } from '@/components/kit/surfaces';
import { announce } from '@/components/site/live-region';
import { writeStore, readStore } from '@/lib/oti/storage';
import { q } from '@/lib/oti/text';
import { fmtClock } from '@/lib/oti/time';
import { presetById } from '@/lib/sample/presets';
import { hasSessionCookie } from '@/lib/supabase/cookie-hint';
import { useQaState, useSearchParam } from '@/lib/use-search-param';
import { carriedMeta, codesLimited, codeWrong, JOIN_COPY, mmss, OTP_TIMING, triesLimited } from './copy';
import { useCarriedRules, useDocumentTitle, useFocusAfterCommit, type CarriedRules } from './hooks';

/**
 * /join (ux-spec S3): sign in with a 6-digit email code (Supabase signInWithOtp / verifyOtp in server actions; never
 * a magic link). Rules carried from the playground ride along and are saved only by the verify action.
 *
 * Without Supabase on this instance the page says so and shows no form. QA states (`?state=`, development or
 * QA_STATES=1) render the prototype's states and simulate the round trips like the prototype did: code 000000 is
 * wrong, 111111 is expired, any other code signs in to the SAMPLE /me.
 */

type EmailErr = { kind: 'invalid' | 'offline' | 'down' | 'not_authorized' | 'not_available' | 'limited'; retryAt: number | null };
type CodeErr = { kind: 'incomplete' | 'wrong' | 'no_tries' | 'expired' | 'offline' | 'down' | 'limited'; tries: number; retryAt?: number | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const QA_EMAIL = 'ana@example.com';
const QA_CLOCK = '10:40';

function defaultCarried(): CarriedRules {
  const p = presetById('engineer');
  return { rules: p.rules, cap: p.cap, preset: p.id, label: p.label };
}

export function JoinView({ available, qa }: { available: boolean; qa: boolean }) {
  const router = useRouter();
  const qaState = useQaState('join', qa);
  const nextParam = useSearchParam('next');
  const stored = useCarriedRules();
  const simulate = qaState !== null;
  const carried = stored ?? (qaState === 'email-carried' ? defaultCarried() : null);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [emailErr, setEmailErr] = useState<EmailErr | null>(null);
  const [codeErr, setCodeErr] = useState<CodeErr | null>(null);
  const [limitedAt, setLimitedAt] = useState<number | null | undefined>(undefined);
  const [tries, setTries] = useState<number>(OTP_TIMING.triesPerCode);
  const [busy, setBusy] = useState(false);
  const [sends, setSends] = useState(1);
  const [appliedQa, setAppliedQa] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusLater = useFocusAfterCommit();
  const codeRef = useRef<HTMLInputElement>(null);

  // Render a QA state straight from the URL once it is known (after hydration), like the prototype's ?state=.
  if (qaState !== appliedQa) {
    setAppliedQa(qaState);
    if (qaState && /^(code|resend)/.test(qaState)) {
      const left = { code: 47, 'code-wrong': 47, 'code-delayed': OTP_TIMING.slowAtS, 'resend-ready': 0, 'code-expired': 0, 'code-limited': 0 }[qaState as string] ?? 47;
      setStep('code');
      setSentTo(QA_EMAIL);
      setSentAt(now - (OTP_TIMING.resendAfterS - left) * 1000);
      setResendAt(now + left * 1000);
      setLimitedAt(qaState === 'code-limited' ? null : undefined);
      if (qaState === 'code-wrong') {
        setTries(4);
        setCode('000000');
        setCodeErr({ kind: 'wrong', tries: 4 });
      }
      if (qaState === 'code-expired') {
        setCode('111111');
        setCodeErr({ kind: 'expired', tries: 0 });
      }
    } else if (qaState === 'email-invalid') {
      setEmail('ana@example');
      setEmailErr({ kind: 'invalid', retryAt: null });
    }
  }

  // The resend countdown ticks while the code step is open.
  useEffect(() => {
    if (step !== 'code') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  // Signed in already (the header's cookie hint), arriving without ?next=: go to Your gate. With rules from the
  // playground, /me offers them as unsaved changes. ?next= means a protected page just sent us here, so stay.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!available || (qa && params.has('state')) || params.has('next')) return;
    if (!hasSessionCookie(document.cookie)) return;
    router.replace(readStore('playground')?.rules?.trim() ? '/me?carried=1' : '/me');
  }, [available, qa, router]);

  // The metadata title is “Sign in”; with rules carried the page reads “Join with your rules”.
  useDocumentTitle(carried ? `${JOIN_COPY.titleJoin} · OK to Intro` : null);

  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const canResend = left <= 0;


  function codeSent(to: string, at: number, resendInS: number, message: string) {
    const t = Date.now();
    setSentTo(to);
    setSentAt(at);
    setNow(t);
    setResendAt(t + resendInS * 1000);
    setStep('code');
    setCode('');
    setCodeErr(null);
    setLimitedAt(undefined);
    setTries(OTP_TIMING.triesPerCode);
    writeStore('join', { v: 1, email: to, step: 'code' });
    announce(message);
    focusLater('#join-code-in');
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL_RE.test(v)) {
      setEmailErr({ kind: 'invalid', retryAt: null });
      focusLater('#join-email-in');
      return;
    }
    if (busy) return;
    setEmailErr(null);
    setBusy(true);
    try {
      if (simulate) {
        await new Promise((r) => setTimeout(r, 350));
        codeSent(v, Date.now(), OTP_TIMING.resendAfterS, `Code sent to ${v}.`);
        return;
      }
      const res = await sendCode({ email: v });
      if (res.ok) {
        codeSent(v.toLowerCase(), res.sent_at, res.resend_in_s, `Code sent to ${v}.`);
        return;
      }
      setEmailErr({ kind: res.error === 'invalid_email' ? 'invalid' : res.error, retryAt: res.retry_at ? Date.parse(res.retry_at) : null });
      focusLater('#join-email-in');
    } catch {
      setEmailErr({ kind: 'offline', retryAt: null });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy(true);
    try {
      if (simulate) {
        await new Promise((r) => setTimeout(r, 350));
        if (sends >= 3) {
          setLimitedAt(null);
          announce(codesLimited(QA_CLOCK));
          return;
        }
        setSends((s) => s + 1);
        codeSent(sentTo, Date.now(), OTP_TIMING.resendAfterS, `New code sent to ${sentTo}.`);
        return;
      }
      const res = await sendCode({ email: sentTo });
      if (res.ok) {
        codeSent(sentTo, res.sent_at, res.resend_in_s, `New code sent to ${sentTo}.`);
        return;
      }
      if (res.error === 'limited') {
        const at = res.retry_at ? Date.parse(res.retry_at) : null;
        setLimitedAt(at);
        announce(at ? codesLimited(fmtClock(at)) : JOIN_COPY.limitedSoon);
        return;
      }
      setCodeErr({ kind: res.error === 'down' || res.error === 'not_available' || res.error === 'not_authorized' ? 'down' : 'offline', tries });
    } catch {
      setCodeErr({ kind: 'offline', tries });
    } finally {
      setBusy(false);
    }
  }

  async function verify(digits: string) {
    if (digits.length !== 6) {
      setCodeErr({ kind: 'incomplete', tries });
      focusLater('#join-code-in');
      return;
    }
    if (busy) return;
    if (tries <= 0) {
      setCodeErr({ kind: 'no_tries', tries: 0 });
      return;
    }
    setBusy(true);
    try {
      if (simulate) {
        await new Promise((r) => setTimeout(r, 350));
        if (digits === '000000') {
          const t = Math.max(0, tries - 1);
          setTries(t);
          setCodeErr({ kind: t ? 'wrong' : 'no_tries', tries: t });
          announce(codeWrong(t));
          codeRef.current?.select();
          return;
        }
        if (digits === '111111') {
          setCodeErr({ kind: 'expired', tries: 0 });
          announce(JOIN_COPY.codeExpired);
          return;
        }
        writeStore('join', { v: 1, email: sentTo, step: 'verified' });
        router.replace('/me?state=first');
        return;
      }
      const res = await verifyCode({ email: sentTo, code: digits, sent_at: sentAt, carried: carried ? { rules: carried.rules, cap: carried.cap } : null, next: nextParam });
      if (res.ok) {
        writeStore('join', { v: 1, email: sentTo, step: 'verified' });
        announce('Signed in.');
        router.replace(res.next);
        return;
      }
      if (res.error === 'rejected') {
        const expired = Date.now() - sentAt > OTP_TIMING.codeTtlS * 1000;
        setTries(res.tries_left);
        setCodeErr(expired ? { kind: 'expired', tries: 0 } : { kind: 'wrong', tries: res.tries_left });
        announce(expired ? JOIN_COPY.codeExpired : codeWrong(res.tries_left));
        codeRef.current?.select();
        return;
      }
      if (res.error === 'no_tries') {
        setTries(0);
        setCodeErr({ kind: 'no_tries', tries: 0 });
        announce(JOIN_COPY.noTries);
        return;
      }
      if (res.error === 'limited') {
        const retryAt = res.retry_at ? Date.parse(res.retry_at) : null;
        setCodeErr({ kind: 'limited', tries, retryAt });
        announce(retryAt ? triesLimited(fmtClock(retryAt)) : JOIN_COPY.triesLimited);
        return;
      }
      setCodeErr({ kind: res.error === 'invalid_code' ? 'incomplete' : 'down', tries });
    } catch {
      setCodeErr({ kind: 'offline', tries });
    } finally {
      setBusy(false);
    }
  }

  function onCodeInput(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (codeErr && codeErr.kind !== 'expired' && codeErr.kind !== 'no_tries') setCodeErr(null);
    if (digits.length === 6) void verify(digits);
  }

  function onCodePaste(e: ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    e.preventDefault();
    onCodeInput(digits);
  }

  function change() {
    setStep('email');
    setEmail(sentTo || email);
    setEmailErr(null);
    focusLater('#join-email-in');
  }

  const title = carried ? JOIN_COPY.titleJoin : JOIN_COPY.titleSignIn;

  const head = (
    <header className="page-head page-head--left">
      <h1 className="title" id="join-title">
        {title}
      </h1>
      {available || simulate ? <p className="lede">{JOIN_COPY.lede}</p> : null}
      {!carried && (available || simulate) ? (
        <p className="meta" id="join-new">
          {JOIN_COPY.newHere}{' '}
          <Link className="link" href="/rules">
            {JOIN_COPY.writeFirst}
          </Link>
        </p>
      ) : null}
    </header>
  );

  const card = carried ? (
    <section aria-labelledby="join-carried-h">
      <Card className="join-carried">
        <div className="join-carried__top">
          <p className="label" id="join-carried-h">
            {JOIN_COPY.carriedLabel}
          </p>
          <ButtonLink size="sm" href="/rules">
            Edit
          </ButtonLink>
        </div>
        <p className="meta">{carriedMeta(carried.rules, carried.cap, carried.label)}</p>
        <p className="join-carried__line">{q(carried.rules.split('\n').find((l) => l.trim()) ?? '')}</p>
      </Card>
    </section>
  ) : null;

  if (!available && !simulate) {
    return (
      <>
        {head}
        {card}
        <div className="join-unavailable">
          <Notice title={JOIN_COPY.unavailableTitle} role="status">
            {JOIN_COPY.unavailableBody}
          </Notice>
          <ButtonRow>
            <ButtonLink variant="primary" size="lg" href="/rules" primary>
              {JOIN_COPY.tryPlayground}
            </ButtonLink>
          </ButtonRow>
        </div>
      </>
    );
  }

  const emailMessage = emailErr ? emailErrorText(emailErr) : null;
  const codeMessage = codeErr ? codeErrorText(codeErr) : null;
  const needsNewCode = codeErr?.kind === 'expired' || (codeErr?.kind === 'no_tries' && canResend);

  return (
    <>
      {head}
      {card}

      <form className="join-form" id="join-email" method="post" noValidate onSubmit={onSend} hidden={step !== 'email'}>
        <Field>
          <Label htmlFor="join-email-in">{JOIN_COPY.emailLabel}</Label>
          <Input
            ref={emailRef}
            id="join-email-in"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={JOIN_COPY.emailPlaceholder}
            required
            value={email}
            invalid={emailErr?.kind === 'invalid'}
            aria-describedby={[emailMessage ? 'join-email-err' : null, carried ? 'join-email-help' : null].filter(Boolean).join(' ') || undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailErr) setEmailErr(null);
            }}
          />
          {emailMessage ? (
            <p className="error-text" id="join-email-err">
              {emailMessage}
            </p>
          ) : null}
        </Field>
        <ButtonRow>
          <Button variant="primary" size="lg" type="submit" primary busy={busy && step === 'email'}>
            {JOIN_COPY.sendCode}
          </Button>
        </ButtonRow>
        {carried ? (
          <p className="help" id="join-email-help">
            {JOIN_COPY.helpCarried}
          </p>
        ) : null}
      </form>

      <form
        className="join-form"
        id="join-code"
        method="post"
        noValidate
        hidden={step !== 'code'}
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        <div className="join-sent">
          <p>
            Enter the 6-digit code we sent to <b>{sentTo}</b>.
          </p>
          <Button variant="ghost" size="sm" onClick={change}>
            {JOIN_COPY.change}
          </Button>
        </div>
        <Field>
          <Label htmlFor="join-code-in">{JOIN_COPY.codeLabel}</Label>
          <CodeInput
            ref={codeRef}
            id="join-code-in"
            name="code"
            value={code}
            invalid={Boolean(codeErr && codeErr.kind !== 'offline' && codeErr.kind !== 'down')}
            aria-describedby={codeMessage ? 'join-code-err' : undefined}
            onChange={(e) => onCodeInput(e.target.value)}
            onPaste={onCodePaste}
          />
          {codeMessage ? (
            <p className="error-text join-error" id="join-code-err">
              <span>{codeMessage}</span>
              {needsNewCode ? (
                <Button size="sm" onClick={() => void resend()} busy={busy}>
                  {JOIN_COPY.sendNewOne}
                </Button>
              ) : null}
            </p>
          ) : null}
        </Field>
        <ButtonRow>
          <Button variant="primary" size="lg" type="submit" primary busy={busy && step === 'code'}>
            {JOIN_COPY.verify}
          </Button>
        </ButtonRow>
        <div className="join-resend" id="join-resend">
          {limitedAt !== undefined ? (
            <p className="error-text">{limitedAt === null ? (simulate ? codesLimited(QA_CLOCK) : JOIN_COPY.limitedSoon) : codesLimited(fmtClock(limitedAt))}</p>
          ) : codeErr?.kind === 'expired' ? null : canResend ? (
            needsNewCode ? null : (
              <Button onClick={() => void resend()} busy={busy}>
                {JOIN_COPY.resendCode}
              </Button>
            )
          ) : left <= OTP_TIMING.slowAtS ? (
            <p className="help">
              The code is taking longer than usual. Check spam, or send a new one in <span>{mmss(left)}</span>.
            </p>
          ) : (
            <p className="help">
              Resend code in <span>{mmss(left)}</span>
            </p>
          )}
        </div>
      </form>
    </>
  );
}

function emailErrorText(err: EmailErr): string {
  switch (err.kind) {
    case 'invalid':
      return JOIN_COPY.emailInvalid;
    case 'offline':
      return JOIN_COPY.offline;
    case 'down':
      return JOIN_COPY.down;
    case 'not_authorized':
      return JOIN_COPY.notAuthorized;
    case 'not_available':
      return JOIN_COPY.unavailableTitle;
    case 'limited':
      return err.retryAt ? codesLimited(fmtClock(err.retryAt)) : JOIN_COPY.limitedSoon;
  }
}

function codeErrorText(err: CodeErr): string {
  switch (err.kind) {
    case 'incomplete':
      return JOIN_COPY.codeIncomplete;
    case 'wrong':
      return codeWrong(err.tries);
    case 'no_tries':
      return JOIN_COPY.noTries;
    case 'expired':
      return JOIN_COPY.codeExpired;
    case 'offline':
      return JOIN_COPY.offline;
    case 'down':
      return JOIN_COPY.down;
    case 'limited':
      return err.retryAt ? triesLimited(fmtClock(err.retryAt)) : JOIN_COPY.triesLimited;
  }
}
