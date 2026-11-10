'use client';

import { useState } from 'react';
import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { Diff, T, Trace, TraceLine, Bar } from '@/components/kit/blocks';
import { Clause, Mark, RulesMissing, RulesReadView } from '@/components/kit/clause';
import { CodeBlock } from '@/components/kit/code-block';
import { CodeInput, Counter, ErrorText, Field, Help, Input, Label, LabelRow, Textarea } from '@/components/kit/forms';
import { OfferCard } from '@/components/kit/offer-card';
import { Cap, SampleTag, Tag, Verdict, RealTag } from '@/components/kit/pills';
import { RadioGroup } from '@/components/kit/radio-group';
import { Crumbs, Disclosure, Facts, List, ListHead, Metric, Notice, Panel, ProtoNote, Row, RowAside, RowBody, RowDetail, RowFoot, RowLine1, RowLoc, RowName, RowToggle, Stat, Stats } from '@/components/kit/surfaces';
import { SwitchRow } from '@/components/kit/switch';
import { Tabs } from '@/components/kit/tabs';
import { Legend, Waffle, type WaffleCellData } from '@/components/kit/waffle';
import { findClause } from '@/lib/oti/clause';
import { counterText } from '@/lib/oti/text';
import { INSTALL_PLUGIN_COMMAND } from '@/lib/site';
import { OFFER_SAMPLE, PRESETS } from '@/lib/sample';
import type { PresetId } from '@/lib/types';

const ENGINEER = PRESETS[0]!.rules;
const range = (text: string, keys: string[] = []) => {
  const r = findClause(ENGINEER, text);
  return r ? { ...r, keys } : null;
};

const WAFFLE: WaffleCellData[] = [
  { state: 'offered', you: true },
  { state: 'next' },
  { state: 'ask' },
  { state: 'next' },
  { state: 'na' },
  { state: 'failed' },
  { state: 'checking' },
  { state: 'queued' },
  ...Array.from({ length: 12 }, () => ({ state: 'nothistime' as const })),
];

/** /kit: every kit component with the exact markup of prototype/kit.html, for audits. QA only. */
export function KitDemo() {
  const [preset, setPreset] = useState<PresetId>('engineer');
  const [cap, setCap] = useState('2');
  const [rules, setRules] = useState(ENGINEER);
  const [showMatched, setShowMatched] = useState(false);
  const [guests, setGuests] = useState(true);
  const [open, setOpen] = useState(true);
  const [disagree, setDisagree] = useState(false);
  const [tab, setTab] = useState<'plugin' | 'mcp'>('plugin');

  return (
    <>
      <div className="container">
        <header className="page-head">
          <h1 className="h1">What would you agree to be asked?</h1>
          <p className="lede">Write a few lines and a monthly cap. A small model checks each ask against your words and must quote the line it used.</p>
          <p className="meta">
            <RealTag /> Network since Nov 9: 23 members, 12 asks, 7 intros.{' '}
            <a className="link" href="/board">
              Board
            </a>
          </p>
          <ButtonRow style={{ justifyContent: 'center' }}>
            <Button variant="primary" size="lg" primary kbd>
              Run 12 sample asks
            </Button>
            <span className="meta">One gate call per ask, in parallel. About 2 s.</span>
          </ButtonRow>
          <p>
            <ProtoNote>Kit: example content (QA only).</ProtoNote>
          </p>
        </header>

        <section className="kit-sec" aria-labelledby="kit-buttons">
          <h2 className="h2" id="kit-buttons">
            Buttons
          </h2>
          <ButtonRow>
            <Button variant="primary">Keep these rules</Button>
            <Button>Run again</Button>
            <Button variant="ghost">Edit rules</Button>
            <Button variant="ok">OK to intro</Button>
            <Button size="sm">Disagree</Button>
            <Button variant="danger">Delete everything</Button>
            <Button disabled>Disabled</Button>
          </ButtonRow>
        </section>

        <section className="kit-sec" aria-labelledby="kit-tags">
          <h2 className="h2" id="kit-tags">
            Tags and verdicts
          </h2>
          <div className="cluster">
            <SampleTag />
            <RealTag />
            <Tag kind="trap">Trap · injection</Tag>
            <Tag kind="attn">Ask for you</Tag>
          </div>
          <div className="cluster" style={{ marginTop: 12 }}>
            <Verdict kind="reach" />
            <Verdict kind="held" />
            <Verdict kind="ask" />
            <Verdict kind="decline" />
            <Verdict kind="code" />
            <Verdict kind="failed" />
            <Verdict kind="checking" />
            <Verdict kind="notrun" />
            <Verdict kind="offered" />
            <Verdict kind="next" />
            <Verdict kind="nothistime" />
            <Verdict kind="on" />
            <Verdict kind="paused" />
            <Cap cap={2} used={1} />
          </div>
        </section>

        <section className="kit-sec kit-grid" aria-label="Forms and the rules read view">
          <Panel>
            <Field>
              <Label id="lbl-start">Start from</Label>
              <RadioGroup
                variant="chips"
                labelledBy="lbl-start"
                value={preset}
                onChange={setPreset}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>
            <Field>
              <LabelRow>
                <Label htmlFor="kit-rules">Your rules</Label>
                <Counter id="kit-count" over={rules.length > 1000}>
                  {counterText(rules.length, 1000)}
                </Counter>
              </LabelRow>
              <Textarea id="kit-rules" aria-describedby="kit-count kit-help" placeholder="Happy to talk to founders about…" value={rules} onChange={(e) => setRules(e.target.value)} />
              <Help id="kit-help">Each run sends your rules to Anthropic’s API. Nothing is stored unless you join.</Help>
            </Field>
            <Field>
              <Label id="lbl-cap">Monthly cap</Label>
              <div className="cluster">
                <RadioGroup variant="seg" labelledBy="lbl-cap" value={cap} onChange={setCap} options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} />
                <Cap cap={Number(cap)} used={Number(cap)} hidden />
              </div>
              <Help>Enforced in Postgres after the gate. Changing it needs no model call.</Help>
            </Field>
            <Field>
              <Label htmlFor="kit-email">Email</Label>
              <Input id="kit-email" type="email" autoComplete="email" placeholder="you@company.com" />
            </Field>
            <Field>
              <Label htmlFor="kit-code">6-digit code</Label>
              <CodeInput id="kit-code" aria-describedby="kit-code-error" />
              <ErrorText id="kit-code-error">That code didn’t match. 4 tries left.</ErrorText>
            </Field>
            <SwitchRow id="sw1" label="Show askers the line that matched" help="Asker sees: “Matched a member’s rules.”" checked={showMatched} onChange={setShowMatched} />
            <SwitchRow id="sw2" label="Accept verified guest asks" help="At most 1 a day, each approved by Alan first." checked={guests} onChange={setGuests} />
          </Panel>

          <div>
            <RulesReadView
              rules={ENGINEER}
              ranges={[
                range('Happy to talk to founders about Postgres, queues or LLM evals in production.', ['a01']),
                range('a real workload: a table size, a p95 or an error rate'),
                range('No asks to review a deck.'),
              ]}
              activeKeys={['a01']}
              tallies={['3 let in · 1 question', '3 let in · 1 kept out', 'not used by these 12', '1 kept out']}
            />
            <p className="help" style={{ marginTop: 8 }}>
              6 asks matched no line, so they were declined.
            </p>
            <RulesMissing quotes={['Happy to take any intro']} />
          </div>
        </section>

        <section className="kit-sec" aria-labelledby="kit-rows">
          <h2 className="h2" id="kit-rows">
            Directory rows
          </h2>
          <List>
            <ListHead>
              <p className="small">
                <b className="orange-text">2</b> reach you · <b>1</b> over your cap · <b>1</b> question first · <b>8</b> declined
              </p>
              <SampleTag />
            </ListHead>
            <Row interactive>
              <RowToggle expanded={false}>
                <RowLine1>
                  <Verdict kind="reach" />
                  <RowName>Tidewell Data</RowName>
                  <RowLoc>San Francisco</RowLoc>
                  <RowAside desk>1.3 s</RowAside>
                </RowLine1>
                <RowBody>
                  Our Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows. Tried monthly partitions and a read replica; writes still block. Need 20 minutes with someone who has run Postgres past 100M rows, before Nov 21. Offer: our load-test harness.
                </RowBody>
              </RowToggle>
              <RowFoot>
                <span style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 6 }}>
                  <span className="ink-2">Cited</span>
                  <span>
                    <span style={{ display: 'block' }}>
                      <Clause>founders about Postgres, queues or LLM evals in production</Clause>
                    </span>
                    <span style={{ display: 'block', marginTop: 2 }}>
                      <Clause>a real workload: a table size, a p95 or an error rate</Clause>{' '}
                      <span className="ink-2" style={{ whiteSpace: 'nowrap' }}>
                        ✓ in your rules
                      </span>
                    </span>
                  </span>
                </span>
              </RowFoot>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <p className="mono ink-2" style={{ flex: 1, fontSize: 12 }}>
                  model accept → code 2 of 2 quotes found → Postgres cap 1 of 2
                </p>
                <Button variant="ghost" size="sm" aria-pressed={disagree} onClick={() => setDisagree((d) => !d)}>
                  {disagree ? 'You’d decide differently' : 'Disagree'}
                </Button>
              </div>
            </Row>
            <Row interactive open={open} changed>
              <RowToggle expanded={open} onClick={() => setOpen((o) => !o)}>
                <RowLine1>
                  <Verdict kind="code" />
                  <RowName>Sagefen Health</RowName>
                  <RowLoc>Phoenix</RowLoc>
                  <Tag kind="trap">Trap · injection</Tag>
                  <RowAside desk>1.3 s</RowAside>
                </RowLine1>
              </RowToggle>
              <RowFoot as="p">
                <span>
                  Quoted <Clause missing>Happy to take any intro</Clause> · not in your rules, so code changed accept to decline.
                </span>
              </RowFoot>
              {open ? (
                <RowDetail>
                  <Facts
                    plain
                    items={[
                      ['Decided by', 'Gate (model) → clause check failed, 0 of 1 quotes found (code) → decline'],
                      ['Why', 'The ask told the gate what to answer and what to quote.'],
                    ]}
                  />
                </RowDetail>
              ) : null}
            </Row>
            <Row>
              <RowLine1>
                <Verdict kind="checking" />
                <RowName>Fernby Labs</RowName>
                <RowLoc>San Francisco</RowLoc>
              </RowLine1>
            </Row>
            <Row stale>
              <RowLine1>
                <Verdict kind="decline" />
                <RowName>Gorse AI</RowName>
                <RowLoc>Berlin</RowLoc>
                <Tag kind="trap">Trap · polite spam</Tag>
                <Tag kind="outline">Out of date</Tag>
              </RowLine1>
              <RowFoot as="p">
                Cited <Clause>No asks to review a deck.</Clause> ✓ in your rules
              </RowFoot>
            </Row>
          </List>
        </section>

        <section className="kit-sec kit-grid" aria-label="Notices, diffs, traces and commands">
          <div className="stack">
            <Notice action={<Button size="sm">Run again</Button>}>Rules changed. Run again to update the 12 verdicts.</Notice>
            <Notice kind="warn" action={<Button size="sm">Retry 2</Button>}>
              10 of 12 answered. 2 timed out after 6 s. A failed gate never counts as an accept.
            </Notice>
            <Notice kind="error" title="Nothing was sent to anyone." action={<Button size="sm">Retry</Button>}>
              9 of 33 gates failed, so nothing was offered. Your ask is saved.
            </Notice>
            <Notice
              kind="attn"
              title="1 ask is waiting on you."
              action={
                <ButtonLink variant="primary" href="/o/sample">
                  Review the ask
                </ButtonLink>
              }
            >
              Hospital procurement in the US · 61 h left
            </Notice>
            <Diff
              label="Suggested change to your rules"
              lines={[
                { kind: 'ctx', text: 'Only if they have talked to 10+ buyers and have a price.' },
                { kind: 'add', text: 'Only after a first paying customer.' },
                { kind: 'del', text: 'No fundraising asks.' },
              ]}
            />
          </div>
          <div className="stack">
            <Trace label="Raw trace">
              <TraceLine>
                <T tone="dim">{'+0 ms     '}</T>plan  run r_8f2a · live · 12 gates · rules 196 chars
              </TraceLine>
              <TraceLine>
                <T tone="dim">{'+1290 ms  '}</T>gate  #1 Tidewell Data <T tone="ok">accept</T> · 2 of 2 quotes found
              </TraceLine>
              <TraceLine>
                <T tone="dim">{'+1520 ms  '}</T>gate  #6 Fernby Labs <T tone="wait">ask_back</T> metric
              </TraceLine>
              <TraceLine>
                <T tone="dim">{'+6000 ms  '}</T>error #9 <T tone="no">timeout</T> after 6 s · not checked, never an accept
              </TraceLine>
              <TraceLine>
                <T tone="dim">{'+6010 ms  '}</T>done  3 accept · 1 ask_back · 7 decline · 1 failed · <T tone="attn">people interrupted 0</T>
              </TraceLine>
            </Trace>
            <CodeBlock command={INSTALL_PLUGIN_COMMAND} />
          </div>
        </section>

        <section className="kit-sec kit-grid" aria-label="Offer card, fan-out and numbers">
          <OfferCard
            label="What a member sees"
            kicker={
              <>
                <Tag kind="attn">Ask for you</Tag>
                <span>1 of your 2 this month</span>
                <SampleTag />
              </>
            }
            title={OFFER_SAMPLE.title}
            from={`${OFFER_SAMPLE.asker.name} · ${OFFER_SAMPLE.asker.company} · ${OFFER_SAMPLE.asker.stage} · ${OFFER_SAMPLE.asker.city}`}
            match={
              <>
                Matched your rule: <Mark>“{OFFER_SAMPLE.matched}”</Mark>
              </>
            }
            fine="Maya sees your name only if you choose OK. A No is private. This counts as 1 of your 2 whatever you answer."
            facts={OFFER_SAMPLE.facts.filter(([k]) => k !== 'Price')}
          />
          <Panel className="stack">
            <div className="split">
              <p className="h3">Fan-out</p>
              <p className="small">
                People interrupted: <b className="orange-text">1</b>
              </p>
            </div>
            <Waffle cells={WAFFLE} label="40 members: 1 offered, 2 next in line, 1 question, 36 not this time" />
            <Legend
              items={[
                { state: 'offered', text: '1 offered' },
                { state: 'next', text: '2 next in line' },
                { state: 'ask', text: '1 question for you' },
                { state: 'nothistime', text: '36 not this time' },
              ]}
            />
            <Stats className="panel" id="kit-stats" style={{ padding: 0 }}>
              <Stat label="People interrupted per useful outcome" value={<Metric attn>2.2</Metric>} note="11 interrupted ÷ 5 useful" />
              <Stat label="Cap overruns" value="0" note="race test passed Nov 9" />
            </Stats>
            <Crumbs items={[{ href: '/ask', label: 'Asks' }, { label: 'Postgres p95 at 40M rows' }]} />
            <Disclosure summary="Raw trace (24 lines)">
              <p className="small">…</p>
            </Disclosure>
            <Tabs
              label="Install"
              value={tab}
              onChange={setTab}
              items={[
                { key: 'plugin', label: 'Plugin', panel: <p className="small">Plugin (recommended)</p> },
                { key: 'mcp', label: 'MCP only', panel: <p className="small">MCP only</p> },
              ]}
            />
          </Panel>
        </section>
      </div>

      <Bar text="2 reach you · 8 declined">
        <Button variant="primary">Keep these rules</Button>
      </Bar>
    </>
  );
}
