'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/kit/button';
import { Counter, ErrorText, Field, Help, Input, Label, LabelRow, Textarea } from '@/components/kit/forms';
import { Notice } from '@/components/kit/surfaces';
import { GATE_ANSWER_MAX, GATE_ASK_MAX, GATE_ASKER_NAME_MAX, GATE_EMAIL_MAX, LOOSE_EMAIL_RE } from '@/lib/oti/personal-gate';
import type { AskOutcome } from '@/lib/server/personal-gates';

type Action = (slug: string, input: unknown) => Promise<AskOutcome>;

const UNAVAILABLE = 'The checker isn’t answering. Nothing was sent.';

function failureCopy(o: Extract<AskOutcome, { ok: false }>): string {
  switch (o.reason) {
    case 'invalid':
      return o.message;
    case 'rate_limited':
      return 'Too many asks from this address. Try again in a few minutes. Nothing was sent.';
    case 'not_found':
      return 'This gate no longer exists. Nothing was sent.';
    case 'not_configured':
      return 'Personal gates aren’t set up on this instance. Nothing was sent.';
    default:
      return UNAVAILABLE;
  }
}

/** The public ask form on /g/<slug>, and the verdict in place. */
export function AskForm({ slug, name, action }: { slug: string; name: string; action: Action }) {
  const [askerName, setAskerName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<AskOutcome, { ok: true }> | null>(null);
  const [followupOf, setFollowupOf] = useState<{ type: string; question: string } | null>(null);

  async function send(followup?: { type: string; question: string; answer: string }) {
    setError(null);
    if (!askerName.trim()) return setError('Add your name.');
    if (!LOOSE_EMAIL_RE.test(email.trim())) return setError('Check your email address.');
    if (!text.trim()) return setError('Write your ask.');
    if (text.length > GATE_ASK_MAX) return setError('Keep the ask under 1,200 characters.');
    setBusy(true);
    try {
      const res = await action(slug, { asker_name: askerName, asker_email: email, text, followup });
      if (!res.ok) setError(failureCopy(res));
      else {
        setResult(res);
        if (res.verdict === 'ask_back' && !followup) setFollowupOf({ type: res.type, question: res.question });
      }
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onAnswer(e: FormEvent) {
    e.preventDefault();
    if (!followupOf) return;
    if (!answer.trim()) return setError('Write a short answer.');
    void send({ ...followupOf, answer });
  }

  if (result && result.verdict !== 'ask_back') {
    return (
      <section className="panel gate-result" aria-live="polite">
        {result.verdict === 'accept' ? (
          <>
            <h2 className="h2">Sent to {name}.</h2>
            {result.quote ? (
              <p>
                It matched: <q>{result.quote}</q>
              </p>
            ) : null}
            <p>They’ll reply to {email.trim()} if they take it.</p>
          </>
        ) : result.verdict === 'over_cap' ? (
          <>
            <h2 className="h2">Not sent this month.</h2>
            <p>It matches, but {name} has reached their limit for this month. Try again next month.</p>
          </>
        ) : (
          <>
            <h2 className="h2">Not sent.</h2>
            <p>This isn’t something {name} takes right now.</p>
            {result.reason ? <p className="small ink-2">{result.reason}</p> : null}
            <p className="small ink-2">Nothing reaches them.</p>
          </>
        )}
      </section>
    );
  }

  if (result && result.verdict === 'ask_back' && followupOf) {
    return (
      <form className="panel gate-form" onSubmit={onAnswer} noValidate>
        <h2 className="h2">One question first</h2>
        <p>{followupOf.question}</p>
        <Field>
          <LabelRow>
            <Label htmlFor="g-answer">Your answer</Label>
            <Counter over={answer.length > GATE_ANSWER_MAX}>
              {answer.length} / {GATE_ANSWER_MAX}
            </Counter>
          </LabelRow>
          <Textarea id="g-answer" rows={3} maxLength={GATE_ANSWER_MAX} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <Help>Your answer is added to your ask and checked once more.</Help>
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" variant="primary" size="lg" block primary busy={busy} disabled={busy}>
          {busy ? 'Checking…' : 'Send with answer'}
        </Button>
      </form>
    );
  }

  return (
    <form className="panel gate-form" onSubmit={onSubmit} noValidate>
      <Field>
        <Label htmlFor="g-name">Your name</Label>
        <Input id="g-name" autoComplete="name" maxLength={GATE_ASKER_NAME_MAX} value={askerName} onChange={(e) => setAskerName(e.target.value)} />
      </Field>
      <Field>
        <Label htmlFor="g-email">Your email</Label>
        <Input id="g-email" type="email" autoComplete="email" inputMode="email" maxLength={GATE_EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Help>{name} replies here if they take it. It isn’t shown to anyone else.</Help>
      </Field>
      <Field>
        <LabelRow>
          <Label htmlFor="g-ask">Your ask</Label>
          <Counter id="g-ask-count" over={text.length > GATE_ASK_MAX}>
            {text.length.toLocaleString('en-US')} / 1,200
          </Counter>
        </LabelRow>
        <Textarea id="g-ask" rows={7} aria-describedby="g-ask-help g-ask-count" invalid={text.length > GATE_ASK_MAX} value={text} onChange={(e) => setText(e.target.value)} />
        <Help id="g-ask-help">Say what you’re working on, what you tried, and the specific help you want: a call, an intro, an answer.</Help>
      </Field>
      {error ? (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <Button type="submit" variant="primary" size="lg" block primary busy={busy} disabled={busy}>
        {busy ? 'Checking…' : `Send to ${name}`}
      </Button>
    </form>
  );
}
