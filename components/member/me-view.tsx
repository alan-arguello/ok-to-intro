'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createTokenAction, deleteAction, pauseAction, resumeAction, revokeTokenAction, saveSettingsAction, turnOnAction } from '@/app/(site)/me/actions';
import { Bar } from '@/components/kit/blocks';
import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { RulesReadView } from '@/components/kit/clause';
import { Counter, Field, Input, Label, LabelRow, Textarea } from '@/components/kit/forms';
import { Cap, Verdict } from '@/components/kit/pills';
import { RadioGroup } from '@/components/kit/radio-group';
import { Notice, Panel, Popover, ProtoNote } from '@/components/kit/surfaces';
import { SwitchRow } from '@/components/kit/switch';
import { announce } from '@/components/site/live-region';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { findClause, ruleLines, type MarkRange } from '@/lib/oti/clause';
import { RULES_TO_ANTHROPIC } from '@/lib/oti/copy';
import { clearStore, writeStore } from '@/lib/oti/storage';
import { counterText, RULES_MAX } from '@/lib/oti/text';
import { fmtClock } from '@/lib/oti/time';
import { DEFAULT_PRESET, presetForRules } from '@/lib/sample/presets';
import { ROUTES } from '@/lib/site';
import {
  capStatusLine,
  gateOnNotice,
  ledgerHelp,
  ledgerLine,
  matchedOn,
  ME_COPY,
  normalizeRules,
  nothingYet,
  pauseChipLabel,
  pausedUntilLabel,
  PAUSE_CHOICES,
  pauseUntil,
  rulesHelp,
  SAMPLE_TOKEN,
  savedLine,
  type PauseChoice,
} from './copy';
import { useCarriedRules, useDocumentTitle, useFocusAfterCommit } from './hooks';
import { AsksList, DeletedView, TokenPanel, useTimeText, WhoSeesWhat } from './me-parts';
import type { MeInitial, MeProfile, MeToken, TimeLabel } from './me-types';

/**
 * /me (ux-spec S3 “Your gate”): status and pause, the waiting offer, this month's ledger on the rules read view,
 * settings with an explicit Save (dirty state, sticky bar, beforeunload guard), Your asks, Who sees what, the Claude
 * Code token and Your data (export, delete with an inline confirm). First visit (gate not on yet): one Finish block
 * and “Turn on my gate”.
 *
 * mode `real`: every change is a server action (app/(site)/me/actions.ts). mode `sample` (QA states only): the sample
 * member, actions simulated in the tab with the prototype's 350 ms, nothing sent anywhere.
 */

type Draft = Partial<MeProfile> & { rules?: string };
type Busy = null | 'save' | 'turnon' | 'pause' | 'resume' | 'token' | 'delete';
type FieldErrors = { name?: boolean; link?: boolean; rules?: 'empty' | 'too_long' };

const LINK_RE = /^https:\/\/[^\s/]+\.[^\s]+$/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Event-time helpers (module level, so render stays pure). */
const clockNow = (): TimeLabel => ({ iso: null, label: fmtClock(Date.now()), fmt: 'clock' });
const pauseUntilNow = (choice: PauseChoice) => pauseUntil(choice, Date.now());

function sameProfile(a: MeProfile, b: MeProfile): boolean {
  return (
    a.name === b.name &&
    a.one_line === b.one_line &&
    a.company === b.company &&
    a.stage === b.stage &&
    a.city === b.city &&
    a.scheduling_url === b.scheduling_url &&
    a.cap === b.cap &&
    a.show_matched === b.show_matched
  );
}

export function MeView({ initial }: { initial: MeInitial }) {
  const router = useRouter();
  const sample = initial.mode === 'sample';
  const qa = initial.qaState;
  const nowMs = initial.now;
  const tab = useCarriedRules();

  const [saved, setSaved] = useState(() => ({ profile: initial.profile, rules: initial.rules, version: initial.rulesVersion, at: initial.saved as TimeLabel | null }));
  const [status, setStatus] = useState(initial.status);
  const [pausedUntil, setPausedUntil] = useState(initial.pausedUntil);
  const [draft, setDraft] = useState<Draft>(() => (qa === 'dirty' || qa === 'save-failed' ? { cap: 3 } : {}));
  const [failed, setFailed] = useState(qa === 'save-failed');
  const [editing, setEditing] = useState(false);
  const [carriedDismissed, setCarriedDismissed] = useState(false);
  const [justOn, setJustOn] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseChoice, setPauseChoice] = useState<PauseChoice>('month');
  const [token, setToken] = useState<MeToken>(initial.token);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(qa === 'delete-confirm');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [gone, setGone] = useState(qa === 'deleted');
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pauseWrapRef = useRef<HTMLDivElement>(null);
  const tokenSectionRef = useRef<HTMLElement>(null);
  const dataSectionRef = useRef<HTMLElement>(null);

  useDocumentTitle(gone ? 'Deleted · OK to Intro' : null);
  const focusLater = useFocusAfterCommit();

  const firstVisit = status === 'pending';
  // Rules from the playground in this tab: the first visit's rules (SAMPLE, or ?carried=1), or unsaved changes to review.
  // (A first visit with no rules saved yet always takes them: there is nothing to overwrite.)
  const tabApplies =
    Boolean(tab) &&
    !carriedDismissed &&
    (firstVisit ? sample || initial.carried || !saved.rules.trim() : initial.carried) &&
    normalizeRules(tab?.rules ?? '') !== normalizeRules(saved.rules);
  const baseRules = tabApplies && tab ? tab.rules : saved.rules;
  const rules = draft.rules ?? baseRules;
  const profile: MeProfile = { ...saved.profile, ...(firstVisit && tabApplies && tab ? { cap: tab.cap } : {}), ...draft };
  const editorOpen = editing || (firstVisit && !saved.rules.trim() && !tabApplies) || (!firstVisit && tabApplies);
  const dirty = !firstVisit && !gone && (!sameProfile(profile, saved.profile) || normalizeRules(rules) !== normalizeRules(saved.rules));
  const savedCap = saved.profile.cap;
  const capUsed = initial.capUsed;
  const sourceLabel = tabApplies ? ME_COPY.fromPlayground : initial.rulesSourceLabel;
  const savedAt = useTimeText(saved.at, nowMs);

  // Marks and tallies for the rules on screen: the server's per-line tallies, placed by line text, and the quoted
  // words found with the one clause finder (the member's own words at the offsets code found).
  const readView = useMemo(() => {
    const l = initial.ledger;
    if (!l || !l.lines) return { ranges: [] as MarkRange[], tallies: undefined };
    const byText = new Map(l.lines.map((x) => [x.text, x.tally]));
    const lines = ruleLines(saved.rules);
    const tallies = lines.map((line) => byText.get(line.text.trim()) ?? (sample ? `added in version ${saved.version}` : 'not used this month'));
    const ranges: MarkRange[] = [];
    for (const quote of l.quotes) {
      const r = findClause(saved.rules, quote);
      if (!r) continue;
      const line = lines.find((x) => r.start >= x.start && r.start < Math.max(x.end, x.start + 1));
      if (line && /^(not used|added in)/.test(tallies[line.index] ?? '')) continue;
      ranges.push(r);
    }
    return { ranges, tallies };
  }, [initial.ledger, saved.rules, saved.version, sample]);

  const example = useMemo(() => {
    const fromLedger = initial.ledger?.example;
    if (fromLedger && findClause(rules, fromLedger)) return fromLedger;
    // No accept quoted this month: the first line stands in, without its closing period (“…in production”).
    return (rules.split('\n').find((l) => l.trim()) ?? '').trim().replace(/[.;:]+$/, '');
  }, [initial.ledger, rules]);

  /* ----- guards: unsaved changes ----- */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Client-side navigation doesn't fire beforeunload: confirm internal link clicks the same way.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href || href.startsWith('#')) return;
      if (!window.confirm('Leave without saving? Your changes aren’t saved yet.')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  /* ----- the pause popover: Esc and outside clicks close it ----- */
  useEffect(() => {
    if (!pauseOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPauseOpen(false);
        focusLater('#me-pause-btn');
      }
    };
    const onDown = (e: MouseEvent) => {
      if (pauseWrapRef.current && !pauseWrapRef.current.contains(e.target as Node)) setPauseOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pauseOpen, focusLater]);

  /* ----- QA states that land on a section, like the 303 to /me#token after a POST ----- */
  useEffect(() => {
    if (qa === 'token-created' || qa === 'token-revoked') tokenSectionRef.current?.scrollIntoView();
    if (qa === 'delete-confirm') dataSectionRef.current?.scrollIntoView();
    if (qa === 'saved') announce(`Saved. Version ${initial.rulesVersion}.`);
  }, [qa, initial.rulesVersion]);

  function signedOut() {
    router.replace(`${ROUTES.join}?next=${encodeURIComponent('/me')}`);
  }

  // Like the prototype, a failed save keeps “Didn’t save…” and “Retry” in the bar until a save goes through.
  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function validate(requireRulesOpen: boolean): boolean {
    const next: FieldErrors = {};
    if (!profile.name.trim()) next.name = true;
    if (profile.scheduling_url.trim() && !LINK_RE.test(profile.scheduling_url.trim())) next.link = true;
    const r = normalizeRules(rules);
    if (!r.trim()) next.rules = 'empty';
    else if (r.length > RULES_MAX) next.rules = 'too_long';
    setErrors(next);
    if (next.name) {
      focusLater('#me-name');
      return false;
    }
    if (next.link) {
      focusLater('#me-link');
      return false;
    }
    if (next.rules) {
      if (requireRulesOpen) setEditing(true);
      focusLater(firstVisit ? '#me-frules-ta' : '#me-rules-ta');
      return false;
    }
    return true;
  }

  function input() {
    return {
      name: profile.name.trim(),
      one_line: profile.one_line.trim(),
      company: profile.company.trim(),
      stage: profile.stage.trim(),
      city: profile.city.trim(),
      scheduling_url: profile.scheduling_url.trim(),
      cap: profile.cap,
      show_matched: profile.show_matched,
      rules: normalizeRules(rules),
    };
  }

  /* ----- save (on / paused) ----- */
  async function save() {
    if (!dirty || busy) return;
    if (!validate(true)) return;
    const body = input();
    setBusy('save');
    setFailed(false);
    try {
      let version = saved.version;
      let at: TimeLabel = clockNow();
      if (sample) {
        await wait(350);
        version = saved.version + 1;
      } else {
        const res = await saveSettingsAction(body);
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          if (res.reason === 'bad_input' && res.field) {
            setErrors({ name: res.field === 'name', link: res.field === 'scheduling_url', rules: res.field === 'rules' ? 'empty' : undefined });
          }
          setFailed(true);
          announce(ME_COPY.saveFailed);
          return;
        }
        version = res.version;
        at = { iso: res.saved_at, label: fmtClock(Date.parse(res.saved_at)), fmt: 'clock' };
      }
      setSaved({ profile: { ...profile, ...body, scheduling_url: body.scheduling_url }, rules: body.rules, version, at });
      setDraft({});
      setEditing(false);
      setCarriedDismissed(true);
      setErrors({});
      announce(`Saved. Version ${version}.`);
    } catch {
      setFailed(true);
      announce(ME_COPY.saveFailed);
    } finally {
      setBusy(null);
    }
  }

  function discard() {
    setDraft({});
    setEditing(false);
    setCarriedDismissed(true);
    setErrors({});
    setFailed(false);
    announce('Changes discarded.');
  }

  /* ----- first visit: turn the gate on ----- */
  async function turnOn() {
    if (busy) return;
    if (!validate(true)) return;
    const body = input();
    setBusy('turnon');
    try {
      let version = 1;
      let at: TimeLabel = clockNow();
      if (sample) await wait(350);
      else {
        const res = await turnOnAction(body);
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          if (res.reason === 'bad_input' && res.field) {
            setErrors({ name: res.field === 'name', link: res.field === 'scheduling_url', rules: res.field === 'rules' ? 'empty' : undefined });
            return;
          }
          setNoticeError(ME_COPY.down);
          announce(ME_COPY.down);
          return;
        }
        version = res.version;
        at = { iso: res.saved_at, label: fmtClock(Date.parse(res.saved_at)), fmt: 'clock' };
      }
      setSaved({ profile: { ...profile, ...body }, rules: body.rules, version, at });
      setDraft({});
      setEditing(false);
      setCarriedDismissed(true);
      setStatus('on');
      setJustOn(true);
      setNoticeError(null);
      window.scrollTo(0, 0);
      focusLater('#me-on-notice');
      announce('Your gate is on.');
    } catch {
      setNoticeError(ME_COPY.failed);
      announce(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  /* ----- pause and resume ----- */
  async function pause() {
    if (busy) return;
    setBusy('pause');
    try {
      let until = pauseUntilNow(pauseChoice);
      if (sample) await wait(350);
      else {
        const res = await pauseAction(pauseChoice);
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          setNoticeError(ME_COPY.down);
          announce(ME_COPY.down);
          return;
        }
        until = res.paused_until;
      }
      setStatus('paused');
      setPausedUntil(until);
      setPauseOpen(false);
      setNoticeError(null);
      focusLater('#me-resume');
      announce(`Paused. ${pausedUntilLabel(until)}. Offers go to others.`);
    } catch {
      setNoticeError(ME_COPY.failed);
      announce(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    if (busy) return;
    setBusy('resume');
    try {
      if (sample) await wait(350);
      else {
        const res = await resumeAction();
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          setNoticeError(ME_COPY.down);
          announce(ME_COPY.down);
          return;
        }
      }
      setStatus('on');
      setPausedUntil(null);
      setNoticeError(null);
      focusLater('#me-pause-btn');
      announce('Your gate is on.');
    } catch {
      setNoticeError(ME_COPY.failed);
      announce(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  /* ----- token ----- */
  async function createToken() {
    if (busy) return;
    setBusy('token');
    setTokenError(null);
    try {
      let next: MeToken;
      if (sample) {
        await wait(350);
        next = { state: 'new', token: SAMPLE_TOKEN, created: { iso: null, label: 'Nov 9', fmt: 'day' } };
      } else {
        const res = await createTokenAction();
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          setTokenError(res.reason === 'not_configured' ? ME_COPY.tokenOff : ME_COPY.down);
          return;
        }
        next = { state: 'new', token: res.token, created: { iso: res.created_at, label: '', fmt: 'day' } };
      }
      setToken(next);
      focusLater('#me-token-copy');
      announce('Token created. Copy it now; it won’t be shown again.');
    } catch {
      setTokenError(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken() {
    if (busy) return;
    setBusy('token');
    setTokenError(null);
    try {
      if (sample) await wait(350);
      else {
        const res = await revokeTokenAction();
        if (!res.ok) {
          if (res.reason === 'signed_out') return signedOut();
          setTokenError(ME_COPY.down);
          return;
        }
      }
      setToken({ state: 'revoked' });
      announce(ME_COPY.revoked);
      focusLater('#me-token-create');
    } catch {
      setTokenError(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  /* ----- data ----- */
  function exportSample() {
    const data = {
      exported_at: new Date().toISOString(),
      sample: true,
      note: 'SAMPLE preview: the sample member Ana Ruiz, not anyone’s data.',
      name: saved.profile.name || null,
      rules: saved.rules,
      rules_version: saved.version,
      cap: saved.profile.cap,
      scheduling_link: saved.profile.scheduling_url || null,
      show_matched_line: saved.profile.show_matched,
      paused: status === 'paused' ? pausedUntilLabel(pausedUntil) : null,
    };
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ok-to-intro-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      /* ignore */
    }
  }

  async function deleteEverything() {
    if (busy) return;
    setBusy('delete');
    setDeleteError(null);
    try {
      if (sample) {
        await wait(350);
        clearStore('join');
        setGone(true);
        focusLater('#me-gone-h');
        announce('Deleted. Your rules, cap, offers and check-ins are gone.');
        return;
      }
      const res = await deleteAction();
      if (!res.ok) {
        if (res.reason === 'signed_out') return signedOut();
        setDeleteError(ME_COPY.down);
        announce(ME_COPY.down);
        return;
      }
      clearStore('join');
      announce('Deleted. Your rules, cap, offers and check-ins are gone.');
      router.replace('/me/deleted');
    } catch {
      setDeleteError(ME_COPY.failed);
      announce(ME_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  function testRules() {
    const preset = presetForRules(rules);
    writeStore('playground', {
      v: 1,
      preset: preset?.id ?? DEFAULT_PRESET,
      rules,
      cap: profile.cap,
      edited: !preset,
      run_id: null,
      ran_at: null,
      mode: null,
      run_rules: null,
      results: [],
      marks: [],
    });
  }

  /* ========================= render ========================= */

  if (gone) {
    return (
      <div className="container container--col">
        <DeletedView />
      </div>
    );
  }

  const linkInvalid = Boolean(errors.link);
  const rulesCount = rules.length;

  const nameField = (
    <Field>
      <Label htmlFor="me-name">{ME_COPY.name}</Label>
      <Input
        id="me-name"
        name="name"
        autoComplete="name"
        maxLength={80}
        value={profile.name}
        invalid={errors.name}
        aria-describedby={errors.name ? 'me-name-e' : undefined}
        onChange={(e) => {
          setField('name', e.target.value);
          if (errors.name && e.target.value.trim()) setErrors((x) => ({ ...x, name: false }));
        }}
      />
      {errors.name ? (
        <p className="error-text" id="me-name-e">
          {ME_COPY.nameError}
        </p>
      ) : null}
    </Field>
  );

  const oneLineField = (
    <Field>
      <Label htmlFor="me-one">{ME_COPY.oneLine}</Label>
      <Input id="me-one" name="one_line" maxLength={140} autoComplete="organization-title" value={profile.one_line} aria-describedby="me-one-h" onChange={(e) => setField('one_line', e.target.value)} />
      <p className="help" id="me-one-h">
        {ME_COPY.oneLineHelp}
      </p>
    </Field>
  );

  const whoFields = (
    <div className="me-grid2" id="me-who-fields">
      {nameField}
      {oneLineField}
    </div>
  );

  const sentAs = [profile.name.trim(), profile.company.trim(), profile.stage.trim(), profile.city.trim()].filter(Boolean).join(' · ');
  const askerFields = (
    <div className="me-asker">
      <div className="me-grid3">
        <Field>
          <Label htmlFor="me-company">{ME_COPY.company}</Label>
          <Input id="me-company" name="company" maxLength={80} autoComplete="organization" value={profile.company} aria-describedby="me-asker-h" onChange={(e) => setField('company', e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="me-stage">{ME_COPY.stage}</Label>
          <Input id="me-stage" name="stage" maxLength={40} placeholder="Seed" value={profile.stage} aria-describedby="me-asker-h" onChange={(e) => setField('stage', e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="me-city">{ME_COPY.city}</Label>
          <Input id="me-city" name="city" maxLength={60} autoComplete="address-level2" value={profile.city} aria-describedby="me-asker-h" onChange={(e) => setField('city', e.target.value)} />
        </Field>
      </div>
      <p className="help" id="me-asker-h">
        {profile.name.trim() && profile.company.trim() ? `When you ask, the member who gets it sees “${sentAs}”.` : 'Add your name and company to ask the real network.'}
      </p>
    </div>
  );

  const capField = (
    <Field>
      <Label id="me-cap-l">{ME_COPY.capLabel}</Label>
      <div className="cluster">
        <RadioGroup
          variant="seg"
          labelledBy="me-cap-l"
          describedBy="me-cap-h"
          value={String(profile.cap) as `${number}`}
          options={CAP_CHOICES.map((c) => ({ value: String(c) as `${number}`, label: String(c) }))}
          onChange={(v) => setField('cap', Number(v))}
        />
        <Cap cap={profile.cap} used={Math.min(capUsed, profile.cap)} hidden />
        <span className="meta">{`${capUsed} of ${profile.cap} used`}</span>
      </div>
      <p className="help" id="me-cap-h">
        {ME_COPY.capHelp}
      </p>
    </Field>
  );

  const linkField = (
    <Field>
      <Label htmlFor="me-link">{ME_COPY.link}</Label>
      <Input
        id="me-link"
        name="scheduling_link"
        type="url"
        inputMode="url"
        autoComplete="url"
        maxLength={200}
        placeholder={ME_COPY.linkPlaceholder}
        value={profile.scheduling_url}
        invalid={linkInvalid}
        aria-describedby={linkInvalid ? 'me-link-e me-link-h' : 'me-link-h'}
        onChange={(e) => {
          setField('scheduling_url', e.target.value);
          if (linkInvalid && (!e.target.value.trim() || LINK_RE.test(e.target.value.trim()))) setErrors((x) => ({ ...x, link: false }));
        }}
        onBlur={(e) => setErrors((x) => ({ ...x, link: Boolean(e.target.value.trim() && !LINK_RE.test(e.target.value.trim())) }))}
      />
      {linkInvalid ? (
        <p className="error-text" id="me-link-e">
          {ME_COPY.linkError}
        </p>
      ) : null}
      <p className="help" id="me-link-h">
        {ME_COPY.linkHelp}
      </p>
    </Field>
  );

  const switches = (
    <div className="me-switches" id="me-switches">
      <SwitchRow
        id="me-matched"
        label={ME_COPY.matchedLabel}
        help={profile.show_matched ? matchedOn(example) : ME_COPY.matchedOff}
        checked={profile.show_matched}
        onChange={(v) => setField('show_matched', v)}
      />
    </div>
  );

  const rulesEditor = (id: string, labelledBy?: string) => (
    <div className="field me-rules-edit">
      <LabelRow>
        {labelledBy ? (
          <span />
        ) : (
          <label className="label" htmlFor={id}>
            {ME_COPY.yourRules}
          </label>
        )}
        <Counter id={`${id}-c`} over={rulesCount > RULES_MAX}>
          {counterText(rulesCount, RULES_MAX)}
        </Counter>
      </LabelRow>
      <Textarea
        id={id}
        value={rules}
        placeholder={ME_COPY.rulesPlaceholder}
        invalid={Boolean(errors.rules)}
        aria-labelledby={labelledBy}
        aria-describedby={[`${id}-c`, errors.rules ? `${id}-e` : null, `${id}-h`].filter(Boolean).join(' ')}
        onChange={(e) => {
          setField('rules', e.target.value);
          if (errors.rules) setErrors((x) => ({ ...x, rules: undefined }));
        }}
      />
      {errors.rules ? (
        <p className="error-text" id={`${id}-e`}>
          {errors.rules === 'empty' ? ME_COPY.rulesEmpty : ME_COPY.rulesTooLong}
        </p>
      ) : null}
      <p className="help" id={`${id}-h`}>
        {rulesHelp(!firstVisit, saved.version)}
      </p>
    </div>
  );

  /* ----- status line ----- */
  let statusLine: React.ReactNode;
  if (firstVisit) {
    statusLine = (
      <>
        <Verdict kind="notrun">Off</Verdict>
        <span>{ME_COPY.notOnYet}</span>
      </>
    );
  } else if (status === 'paused') {
    statusLine = (
      <>
        <Verdict kind="paused" />
        <span>{`${pausedUntilLabel(pausedUntil)} · ${ME_COPY.offersGoToOthers}`}</span>
      </>
    );
  } else {
    statusLine = (
      <>
        <Verdict kind="on" />
        <span>{capStatusLine(savedCap, capUsed, initial.month)}</span>
        <Cap cap={savedCap} used={Math.min(capUsed, savedCap)} hidden />
      </>
    );
  }

  const ledger = initial.ledger;
  const counts = ledger && ledger.lines ? ledger : null;
  const help = counts ? ledgerHelp(counts) : null;
  const ledgerText = counts ? ledgerLine(counts, savedCap) : nothingYet(savedCap);

  return (
    <div className="container container--col">
      <div id="me-page">
        <header className="page-head page-head--left me-head">
          <h1 className="title" id="me-title" tabIndex={-1}>
            {ME_COPY.title}
          </h1>
          {sample && !firstVisit && !initial.first ? <ProtoNote>{ME_COPY.protoNote}</ProtoNote> : null}
        </header>

        <div className="me-status">
          <p className="me-status__line" id="me-status-line">
            {statusLine}
          </p>
          {!firstVisit ? (
            <div className="me-status__acts">
              {status === 'paused' ? (
                <Button id="me-resume" variant="primary" primary onClick={() => void resume()} busy={busy === 'resume'}>
                  {ME_COPY.resume}
                </Button>
              ) : (
                <div className="me-pause" ref={pauseWrapRef}>
                  <Button
                    id="me-pause-btn"
                    aria-expanded={pauseOpen}
                    aria-controls="me-pause-pop"
                    onClick={() => {
                      const open = !pauseOpen;
                      setPauseOpen(open);
                      if (open) focusLater('#me-pause-pop [aria-checked="true"]');
                    }}
                  >
                    {ME_COPY.pause} ▾
                  </Button>
                  <div hidden={!pauseOpen}>
                    <Popover id="me-pause-pop" label={ME_COPY.pauseNewAsks}>
                      <p className="label" id="me-pause-l">
                        {ME_COPY.pauseNewAsks}
                      </p>
                      <RadioGroup
                        variant="chips"
                        labelledBy="me-pause-l"
                        value={pauseChoice}
                        options={PAUSE_CHOICES.map((c) => ({ value: c, label: pauseChipLabel(c, nowMs) }))}
                        onChange={setPauseChoice}
                      />
                      <ButtonRow>
                        <Button onClick={() => void pause()} busy={busy === 'pause'}>
                          {ME_COPY.pauseAsks}
                        </Button>
                      </ButtonRow>
                    </Popover>
                  </div>
                </div>
              )}
              <ButtonLink href="/" onClick={testRules}>
                {ME_COPY.testRules}
              </ButtonLink>
            </div>
          ) : null}
        </div>

        <div className="me-notice" id="me-notice">
          {justOn ? (
            <div className="notice" id="me-on-notice" tabIndex={-1}>
              <p>{gateOnNotice(savedCap)}</p>
            </div>
          ) : null}
          {initial.pending && !firstVisit ? (
            // An offer that arrived before a pause stays open (ux-spec S3 /pause lede), so it shows while paused too;
            // then Resume keeps the view's one black pill and this action is an outline button.
            <Notice
              kind="attn"
              title="1 ask is waiting on you"
              action={
                status === 'paused' ? (
                  <ButtonLink href={initial.pending.href}>{ME_COPY.reviewAsk}</ButtonLink>
                ) : (
                  <ButtonLink variant="primary" href={initial.pending.href} primary>
                    {ME_COPY.reviewAsk}
                  </ButtonLink>
                )
              }
            >
              {` · ${initial.pending.title} · from ${initial.pending.from} · ${initial.pending.hoursLeft} h left`}
            </Notice>
          ) : null}
          {tabApplies && !firstVisit ? <Notice>{ME_COPY.carriedNotice}</Notice> : null}
          {noticeError ? (
            <Notice kind="error" role="alert">
              {noticeError}
            </Notice>
          ) : null}
        </div>

        {firstVisit ? (
          <section className="section" id="finish" aria-labelledby="me-finish-h">
            <h2 className="sr-only" id="me-finish-h">
              Finish
            </h2>
            <Panel className="me-finish">
              <div data-slot="who">{whoFields}</div>
              <div data-slot="link">{linkField}</div>
              <div className="field">
                <div className="me-rules-src">
                  <span className="label" id="me-frules-l">
                    {ME_COPY.yourRules}
                  </span>
                  <span className="me-rules-src__r">
                    {sourceLabel ? <span className="meta">{sourceLabel}</span> : null}
                    {!editorOpen ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                        {ME_COPY.edit}
                      </Button>
                    ) : null}
                  </span>
                </div>
                {editorOpen ? rulesEditor('me-frules-ta', 'me-frules-l') : <RulesReadView rules={rules} ranges={[]} plain />}
              </div>
              <div className="me-grid2">
                <div data-slot="cap">{capField}</div>
                <div data-slot="switches">{switches}</div>
              </div>
              <div className="me-finish__go hide-phone">
                <Button variant="primary" size="lg" primary onClick={() => void turnOn()} busy={busy === 'turnon'}>
                  {ME_COPY.turnOn}
                </Button>
              </div>
            </Panel>
          </section>
        ) : (
          <>
            <section className="section" id="month" aria-labelledby="me-month-h">
              <div className="me-sec-head">
                <h2 className="h2" id="me-month-h">
                  {ME_COPY.thisMonth}
                </h2>
                <Button
                  id="me-edit"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (editorOpen) {
                      setDraft((d) => {
                        const rest = { ...d };
                        delete rest.rules;
                        return rest;
                      });
                      setEditing(false);
                      setCarriedDismissed(true);
                      setErrors((x) => ({ ...x, rules: undefined }));
                      focusLater('#me-edit');
                    } else {
                      setEditing(true);
                      focusLater('#me-rules-ta');
                    }
                  }}
                >
                  {editorOpen ? ME_COPY.cancel : ME_COPY.editRules}
                </Button>
              </div>
              {editorOpen ? (
                rulesEditor('me-rules-ta')
              ) : (
                <RulesReadView rules={saved.rules} ranges={readView.ranges} tallies={readView.tallies} plain={!readView.tallies} />
              )}
              {help && !editorOpen ? <p className="help me-help">{help}</p> : null}
              <p className="me-ledger">{ledgerText}</p>
            </section>

            <section className="section" id="settings" aria-labelledby="me-set-h">
              <h2 className="h2" id="me-set-h">
                {ME_COPY.settings}
              </h2>
              <Panel className="me-settings">
                <div data-slot="who">
                  {whoFields}
                  {askerFields}
                </div>
                <div data-slot="cap">{capField}</div>
                <div data-slot="link">{linkField}</div>
                <div data-slot="switches">{switches}</div>
                <div className="me-save">
                  {!dirty ? (
                    <Button variant="primary" kbd aria-disabled="true" onClick={() => undefined}>
                      {ME_COPY.save}
                    </Button>
                  ) : null}
                  <p className={dirty ? 'meta is-dirty' : 'meta'} role="status">
                    {dirty ? ME_COPY.unsaved : saved.at ? savedLine(savedAt, saved.version) : `Version ${saved.version}`}
                  </p>
                </div>
              </Panel>
            </section>

            <section className="section" id="asks" aria-labelledby="me-asks-h">
              <div className="me-sec-head">
                <h2 className="h2" id="me-asks-h">
                  {ME_COPY.yourAsks}
                </h2>
                <ButtonLink size="sm" href={ROUTES.ask}>
                  {ME_COPY.newAsk}
                </ButtonLink>
              </div>
              <div>
                <AsksList asks={initial.asks} nowMs={nowMs} />
              </div>
            </section>
          </>
        )}

        <WhoSeesWhat note={RULES_TO_ANTHROPIC} />

        {!firstVisit ? (
          <section className="section" id="token" aria-labelledby="me-tok-h" ref={tokenSectionRef}>
            <h2 className="h2" id="me-tok-h">
              {ME_COPY.tokenTitle}
            </h2>
            <div className="me-token">
              <TokenPanel token={token} nowMs={nowMs} busy={busy === 'token'} error={tokenError} onCreate={() => void createToken()} onRevoke={() => void revokeToken()} />
            </div>
          </section>
        ) : null}

        <section className="section" id="delete" aria-labelledby="me-data-h" ref={dataSectionRef}>
          <h2 className="h2" id="me-data-h">
            {ME_COPY.yourData}
          </h2>
          <div className="me-data" hidden={confirmDelete}>
            {sample ? (
              <button type="button" className="link me-export" onClick={exportSample}>
                {ME_COPY.exportJson}
              </button>
            ) : (
              <a className="link" href={initial.exportHref ?? '/me/export'} download="ok-to-intro-export.json">
                {ME_COPY.exportJson}
              </a>
            )}
            <Button
              id="me-delete"
              variant="danger"
              onClick={() => {
                setConfirmDelete(true);
                setDeleteError(null);
                focusLater('#me-del-no');
              }}
            >
              {ME_COPY.deleteEverything}
            </Button>
          </div>
          {confirmDelete ? (
            <div className="notice notice--error me-confirm" role="group" aria-labelledby="me-confirm-q">
              <p id="me-confirm-q">{ME_COPY.deleteConfirm}</p>
              {deleteError ? (
                <p className="error-text" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <ButtonRow>
                <Button variant="danger" onClick={() => void deleteEverything()} busy={busy === 'delete'}>
                  {ME_COPY.deleteEverything}
                </Button>
                <Button
                  id="me-del-no"
                  variant="ghost"
                  onClick={() => {
                    setConfirmDelete(false);
                    focusLater('#me-delete');
                  }}
                >
                  {ME_COPY.cancel}
                </Button>
              </ButtonRow>
            </div>
          ) : null}
        </section>
      </div>

      {dirty ? (
        <Bar phone={false} id="me-bar" label="Unsaved changes">
          <div className="me-bar__in">
            <p className="bar__text">{ME_COPY.unsaved}</p>
            <Button variant="ghost" onClick={discard}>
              {ME_COPY.discard}
            </Button>
            <Button variant="primary" primary kbd onClick={() => void save()} busy={busy === 'save'}>
              {failed ? ME_COPY.retry : ME_COPY.save}
            </Button>
            {failed ? <p className="error-text">{ME_COPY.saveFailed}</p> : null}
          </div>
        </Bar>
      ) : null}
      {firstVisit ? (
        <Bar>
          <Button variant="primary" size="lg" block primary onClick={() => void turnOn()} busy={busy === 'turnon'}>
            {ME_COPY.turnOn}
          </Button>
        </Bar>
      ) : null}
    </div>
  );
}
