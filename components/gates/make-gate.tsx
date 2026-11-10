'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/kit/button';
import { ErrorText, Field, Help, Input, Label } from '@/components/kit/forms';
import { Notice } from '@/components/kit/surfaces';
import { GATE_HEADLINE_MAX, GATE_NAME_MAX, GATE_STORAGE_KEY, gatePath, inboxPath, isValidSlug, slugify } from '@/lib/oti/personal-gate';
import { SITE_URL } from '@/lib/site';
import { CopyField } from './copy-field';
import '@/styles/gates.css';

type Saved = { slug: string; inbox: string };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(GATE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseSaved(raw: string | null): Saved | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Saved> | null;
    return v && typeof v.slug === 'string' && typeof v.inbox === 'string' && v.inbox.startsWith(SITE_URL) ? { slug: v.slug, inbox: v.inbox } : null;
  } catch {
    return null;
  }
}

const noSubscribe = () => () => undefined;

/** “Your gate: open inbox” on /rules when this browser made one. */
export function SavedGateLink() {
  const raw = useSyncExternalStore(noSubscribe, readRaw, () => null);
  const saved = parseSaved(raw);
  if (!saved) return null;
  return (
    <p className="small">
      Your gate:{' '}
      <a className="link" href={saved.inbox} rel="noreferrer">
        open inbox
      </a>
    </p>
  );
}

/**
 * “Make this your gate” under the rules on /rules, after a run: name, headline, link; saves the current rules and cap
 * as a personal gate (POST /api/gates) and shows the public link and the private inbox link once.
 */
export function MakeGate({ rules, cap, configured }: { rules: string; cap: number; configured: boolean }) {
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ slug: string; token: string } | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  if (!configured) {
    return (
      <section className="panel gate-make" aria-labelledby="gate-make-title">
        <h2 className="h2" id="gate-make-title">
          Make this your gate
        </h2>
        <Notice>Personal gates aren’t set up on this instance.</Notice>
      </section>
    );
  }

  if (made) {
    const publicUrl = `${SITE_URL}${gatePath(made.slug)}`;
    const inboxUrl = `${SITE_URL}${inboxPath(made.slug, made.token)}`;
    return (
      <section className="panel gate-make" aria-labelledby="gate-make-title">
        <h2 className="h2" id="gate-make-title">
          Your gate is live
        </h2>
        <Field>
          <Label htmlFor="gate-public">Public link</Label>
          <CopyField id="gate-public" label="Public link" value={publicUrl} />
          <Help>Share this anywhere: email signature, Bookface, bio.</Help>
        </Field>
        <Field>
          <Label htmlFor="gate-inbox">Private inbox</Label>
          <CopyField id="gate-inbox" label="Private inbox link" value={inboxUrl} />
        </Field>
        <Notice kind="warn" title="Save this link.">
          It’s the only way into your inbox; we can’t recover it.
        </Notice>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Add your name.');
    if (!isValidSlug(effectiveSlug)) return setError('Links use 3 to 40 lowercase letters, numbers or hyphens.');
    setBusy(true);
    try {
      const res = await fetch('/api/gates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, headline: headline || undefined, slug: effectiveSlug, rules, cap }),
      });
      const body = (await res.json().catch(() => null)) as { slug?: string; token?: string; error?: string; message?: string } | null;
      if (res.status === 201 && body?.slug && body.token) {
        const next = { slug: body.slug, token: body.token };
        try {
          window.localStorage.setItem(GATE_STORAGE_KEY, JSON.stringify({ slug: next.slug, inbox: `${SITE_URL}${inboxPath(next.slug, next.token)}` }));
        } catch {
          /* storage blocked: the links are still on screen */
        }
        setMade(next);
      } else if (res.status === 409) setError('That link is taken.');
      else if (res.status === 429) setError('Too many gates from this address. Try again in an hour.');
      else if (body?.error === 'not_configured') setError('Personal gates aren’t set up on this instance.');
      else if (body?.error === 'invalid' && body.message) setError(body.message);
      else setError('That didn’t go through. Nothing was saved. Try again.');
    } catch {
      setError('That didn’t go through. Nothing was saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel gate-make" aria-labelledby="gate-make-title" onSubmit={onSubmit} noValidate>
      <div className="stack">
        <h2 className="h2" id="gate-make-title">
          Make this your gate
        </h2>
        <p className="small ink-2">Get a link anyone can send asks to. Each ask is checked against these rules and your monthly limit; only matches reach your inbox.</p>
      </div>
      <Field>
        <Label htmlFor="gate-name">Your name</Label>
        <Input id="gate-name" autoComplete="name" maxLength={GATE_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field>
        <Label htmlFor="gate-headline">One-line headline (optional)</Label>
        <Input id="gate-headline" maxLength={GATE_HEADLINE_MAX} placeholder="Founder of …, happy to help with …" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      </Field>
      <Field>
        <Label htmlFor="gate-slug">Link</Label>
        <Input
          id="gate-slug"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          aria-describedby="gate-slug-url"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
          }}
        />
        <p className="gate-url" id="gate-slug-url">
          {SITE_URL}
          {gatePath(effectiveSlug || 'your-name')}
        </p>
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" busy={busy} disabled={busy}>
        {busy ? 'Saving…' : 'Get my gate link'}
      </Button>
    </form>
  );
}
