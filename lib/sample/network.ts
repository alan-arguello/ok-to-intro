/**
 * The SAMPLE network: 39 fictional members plus the visitor's own gate (“you”) = 40, and the three SAMPLE asks
 * used on /ask (one per preset). Ported from prototype/data.js. Names exist only for the members an offer can
 * reach; an asker learns a name only after that member says OK.
 *
 * `buildFanout` derives each member's expected result on a sample ask from these tables (hand-authored,
 * source "authored"); data/recorded/sample-network.json is generated from it until BE1 records the 39 gates with
 * the production model.
 */

import type { PresetId, SampleNetworkAskId } from '@/lib/types';
import type { SampleFanoutRow, SampleMember, SampleMemberName, SampleNetworkAsk } from './types';

type Seed = [label: string, city: string, topic: string, rules: string, cap: number, used: number, paused?: boolean];

const MEMBER_SEED: readonly Seed[] = [
  ['m-7f2a', 'San Francisco', 'infra', 'Happy to talk about Postgres or Kafka at scale.', 2, 1],
  ['m-19b4', 'Seattle', 'infra', 'Happy to talk about database performance. Only with real numbers.', 2, 1],
  ['m-c3d0', 'New York', 'infra', 'Happy to talk about Postgres, Redis or queues.', 3, 2],
  ['m-08e1', 'Austin', 'infra', 'Infra questions from seed-stage teams.', 2, 2],
  ['m-5a9c', 'London', 'infra', 'Happy to help with Postgres. No asks about hiring.', 2, 0, true],
  ['m-e4f7', 'San Francisco', 'evals', 'Happy to talk about LLM evals and agent reliability.', 2, 1],
  ['m-2b6d', 'Boston', 'evals', 'LLM evals in production. Only if you have users.', 1, 0],
  ['m-91c8', 'Toronto', 'evals', 'Happy to review eval setups. No asks about fundraising.', 2, 2],
  ['m-6d3e', 'Bangalore', 'evals', 'Applied ML questions from founders with data.', 2, 1],
  ['m-a7f0', 'Chicago', 'health', 'Happy to talk to founders selling to hospitals in the US.', 2, 1],
  ['m-3c5b', 'New York', 'health', 'Public hospital procurement in the US. Only with a price.', 2, 1],
  ['m-f19d', 'Houston', 'health', 'Hospital buyers in Texas.', 1, 1],
  ['m-4e82', 'Toronto', 'health', 'Health founders in Canada with 10+ customer calls.', 2, 0],
  ['m-b0a6', 'Phoenix', 'health', 'Clinic groups and hospital networks in the US.', 2, 1],
  ['m-8d27', 'Vancouver', 'health', 'Hospitals in Canada. No asks from pre-seed companies.', 2, 2],
  ['m-0f4c', 'Toronto', 'insurers', 'Selling to insurers in Canada.', 2, 1],
  ['m-d6e9', 'New York', 'insurers', 'Insurers in the US. Only with signed pilots.', 2, 1],
  ['m-7c1a', 'London', 'insurers', 'Insurtech pricing questions.', 1, 0, true],
  ['m-2e5f', 'New York', 'fintech', 'Cross-border payments and payouts.', 2, 1],
  ['m-a3b8', 'Singapore', 'fintech', 'Happy to talk about fintech compliance.', 2, 1],
  ['m-5f0e', 'Chicago', 'fintech', 'Banking partnerships in the US.', 3, 1],
  ['m-c8d4', 'Lagos', 'fintech', 'Fintech founders with paying customers.', 2, 0],
  ['m-1a7b', 'Denver', 'hiring', 'First engineering hires outside the Bay Area.', 2, 1],
  ['m-9e2c', 'Austin', 'hiring', 'Hiring and comp for seed-stage teams.', 2, 1],
  ['m-4b6f', 'Berlin', 'hiring', 'Happy to talk about remote hiring.', 2, 1],
  ['m-e0d3', 'Seattle', 'hiring', 'Engineering managers, first hires.', 1, 1],
  ['m-6a8e', 'Lagos', 'security', 'Happy to talk about a first SOC 2 audit.', 2, 1],
  ['m-3f9a', 'London', 'security', 'Security reviews for B2B startups.', 2, 1],
  ['m-b7c2', 'Boston', 'security', 'SOC 2 and ISO 27001. Only with a customer asking for it.', 2, 0],
  ['m-0c5d', 'San Francisco', 'angel', 'Pre-seed founders raising in New York.', 2, 1],
  ['m-d2a9', 'São Paulo', 'angel', 'Angel checks for devtools.', 2, 1],
  ['m-8f6b', 'Los Angeles', 'angel', 'Happy to talk about pricing. No deal-flow asks.', 2, 1],
  ['m-1e4d', 'Atlanta', 'angel', 'First customers for B2B SaaS.', 2, 1],
  ['m-7a0f', 'Los Angeles', 'growth', 'Consumer growth and retention.', 2, 1],
  ['m-c5e8', 'New York', 'growth', 'Paid acquisition for consumer apps.', 2, 1],
  ['m-3b2e', 'Mexico City', 'growth', 'Marketplaces: supply and demand.', 2, 1],
  ['m-f6c1', 'London', 'global', 'Expanding from the US to Europe.', 2, 1],
  ['m-9d7a', 'Bangalore', 'global', 'Entering India.', 2, 1],
  ['m-5c3f', 'Singapore', 'global', 'Southeast Asia go-to-market.', 2, 1],
];

/** 39 fictional members. `used`/`cap` is this month's usage. */
export const SAMPLE_MEMBERS: readonly SampleMember[] = MEMBER_SEED.map(([label, city, topic, rules, cap, used, paused]) => ({
  label,
  city,
  topic,
  rules,
  cap,
  used,
  paused: !!paused,
}));

/** The visitor's own gate makes 40. */
export const SAMPLE_NETWORK_SIZE = SAMPLE_MEMBERS.length + 1;

/** Fictional names for the sample members an offer can reach. */
export const SAMPLE_MEMBER_NAMES: Readonly<Record<string, SampleMemberName>> = {
  'm-7f2a': { name: 'Hannah Kim', first: 'Hannah', line: 'Runs data infrastructure at a payments company in San Francisco.', scheduling: 'cal.com/hannah-kim/20min' },
  'm-19b4': { name: 'Marcus Reed', first: 'Marcus', line: 'Ran the database team at a logistics company in Seattle.', scheduling: 'cal.com/marcus-reed/20min' },
  'm-a7f0': { name: 'Priya Shah', first: 'Priya', line: 'Ran procurement for a public hospital network in Illinois.', scheduling: 'cal.com/priya-shah/20min' },
  'm-b0a6': { name: 'Ingrid Larsen', first: 'Ingrid', line: 'Runs a group of 9 clinics in Phoenix.', scheduling: 'cal.com/ingrid-larsen/20min' },
  'm-6a8e': { name: 'Tunde Adeyemi', first: 'Tunde', line: 'Took a payments startup in Lagos through its first SOC 2.', scheduling: 'cal.com/tunde-adeyemi/20min' },
  'm-3f9a': { name: 'Claire Dubois', first: 'Claire', line: 'Leads security reviews for B2B startups in London.', scheduling: 'cal.com/claire-dubois/20min' },
};

export const SAMPLE_NETWORK_ASKS: Readonly<Record<PresetId, SampleNetworkAsk>> = {
  engineer: {
    id: 'sa_eng', preset: 'engineer', based_on: 'a01', topicTag: 'infra',
    as: { name: 'Sample founder', company: 'Tidewell Data', stage: 'Seed', city: 'San Francisco' },
    vague: 'Need intros to people who could help us grow in the US.',
    partial: 'Our Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows. We tried monthly partitions and a read replica; writes still block.',
    complete: 'Our Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows. We tried monthly partitions and a read replica; writes still block. Need 20 minutes with someone who has run Postgres past 100M rows, before Nov 21. Offer: our load-test harness.',
    compiledPartial: [
      { key: 'challenge', state: 'found', text: 'Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows', from: [], question: null, sample: null },
      { key: 'tried', state: 'found', text: 'monthly partitions and a read replica', from: [], question: null, sample: null },
      { key: 'needs', state: 'suggested', text: 'someone who has run Postgres past 100M rows', from: ['writes still block', '40M rows'], question: null, sample: null },
      { key: 'by', state: 'missing', text: '', from: [], question: 'By when do you need this?', sample: 'Nov 21' },
      { key: 'offers', state: 'missing', text: '', from: [], question: 'What can you give the person in return?', sample: 'our load-test harness' },
    ],
    subject: 'Postgres p95 at 40M rows, 20 min?',
    accept: ['m-7f2a', 'm-19b4'],
    ask_back: [['m-c3d0', { type: 'role', text: 'Who on your team would join the call, and what is their role?' }]],
    askBackSample: 'Our CTO, who owns the events pipeline.',
    answeredSample: 'Check pg_locks for long transactions and foreign-key locks first; partitioning rarely fixes blocked writes.',
    noMatchEdit: { context: 'Tried monthly partitions and a read replica; writes still block.', add: 'Our events table takes 2k writes/s at peak.', why: '4 gates wanted a number about your workload. If you have one, add it.' },
    decline: { stage: ['m-2b6d'], proof: ['m-6d3e'], region: ['m-5c3f'] },
    youAskBack: null,
  },
  health: {
    id: 'sa_health', preset: 'health', based_on: 'a02', topicTag: 'health',
    as: { name: 'Sample founder', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' },
    vague: 'Need intros to hospital buyers in the US.',
    partial: 'Selling inventory software to public hospitals in Illinois. 14 buyer calls; 2 committees stalled at technical review.',
    complete: 'Selling inventory software to public hospitals in Illinois. 14 buyer calls; 2 committees stalled at technical review. Need 20 minutes with someone who has sat on a public hospital procurement committee in the US, before Nov 20. Offer: our tender templates.',
    compiledPartial: [
      { key: 'challenge', state: 'found', text: '2 committees stalled at technical review', from: [], question: null, sample: null },
      { key: 'tried', state: 'found', text: '14 buyer calls', from: [], question: null, sample: null },
      { key: 'needs', state: 'suggested', text: 'someone who has sat on a public hospital procurement committee in the US', from: ['public hospitals in Illinois'], question: null, sample: null },
      { key: 'by', state: 'missing', text: '', from: [], question: 'By when do you need this?', sample: 'Nov 20' },
      { key: 'offers', state: 'missing', text: '', from: [], question: 'What can you give the person in return?', sample: 'our tender templates' },
    ],
    subject: 'Hospital procurement in the US, 20 min?',
    accept: ['m-a7f0', 'm-b0a6'],
    ask_back: [['m-3c5b', { type: 'price', text: 'What do you charge per hospital, per year?' }]],
    askBackSample: '$18k a year per hospital',
    answeredSample: 'Ask for the committee’s technical annex before the demo; that’s where pilots stall.',
    noMatchEdit: { context: '14 buyer calls; 2 committees stalled at technical review.', add: 'We charge $18k a year per hospital.', why: '4 gates wanted a price. If you have one, add it.' },
    decline: { proof: ['m-4e82'], region: ['m-0f4c'], stage: ['m-2b6d'] },
    youAskBack: { type: 'price', text: 'What do you charge per hospital, per year?', sampleAnswer: '$18k a year per hospital' },
  },
  founder: {
    id: 'sa_founder', preset: 'founder', based_on: 'a07', topicTag: 'security',
    as: { name: 'Sample founder', company: 'Coppice Pay', stage: 'Pre-seed', city: 'Toronto' },
    vague: 'Need help with compliance for banks.',
    partial: 'Payouts API for marketplaces; 6 paying customers, $9k MRR. Our first bank customer requires SOC 2 Type I in 60 days. Tried Vanta templates; the auditor wants evidence we lack.',
    complete: 'Payouts API for marketplaces; 6 paying customers, $9k MRR. Our first bank customer requires SOC 2 Type I in 60 days. Tried Vanta templates; the auditor wants evidence we lack. Need 20 minutes with someone who passed a first SOC 2 at a small startup, before Nov 30. Offer: our security questionnaire answers.',
    compiledPartial: [
      { key: 'challenge', state: 'found', text: 'Our first bank customer requires SOC 2 Type I in 60 days', from: [], question: null, sample: null },
      { key: 'tried', state: 'found', text: 'Vanta templates; the auditor wants evidence we lack', from: [], question: null, sample: null },
      { key: 'needs', state: 'suggested', text: 'someone who passed a first SOC 2 at a small startup', from: ['SOC 2 Type I'], question: null, sample: null },
      { key: 'by', state: 'missing', text: '', from: [], question: 'By when do you need this?', sample: 'Nov 30' },
      { key: 'offers', state: 'missing', text: '', from: [], question: 'What can you give the person in return?', sample: 'our security questionnaire answers' },
    ],
    subject: 'First SOC 2 in 60 days, 20 min?',
    accept: ['m-6a8e', 'm-3f9a'],
    ask_back: [['m-a3b8', { type: 'deal_size', text: 'How large is the bank contract, per year?' }]],
    askBackSample: '$48k a year, signed for 2 years.',
    answeredSample: 'Ask the auditor for their evidence list on day 1; most Type I gaps are missing policies, not missing controls.',
    noMatchEdit: { context: 'Our first bank customer requires SOC 2 Type I in 60 days.', add: 'The bank contract is $48k a year.', why: '3 gates wanted the deal size. If you have it, add it.' },
    decline: { proof: ['m-c8d4'], region: ['m-5c3f'] },
    youAskBack: null,
  },
};

export function sampleNetworkAskById(id: string): SampleNetworkAsk | null {
  return Object.values(SAMPLE_NETWORK_ASKS).find((s) => s.id === id) ?? null;
}

export function isSampleNetworkAskId(id: unknown): id is SampleNetworkAskId {
  return id === 'sa_eng' || id === 'sa_health' || id === 'sa_founder';
}

/** What an accept by this member cites: the first sentence of their rules, without the final period. */
export function memberCitation(member: SampleMember): string {
  return (member.rules.split('. ')[0] ?? member.rules).replace(/\.$/, '');
}

/**
 * Each of the 39 sample members' expected result on a sample ask (port of data.js `buildFanout`, without the
 * invented latencies). SQL skips (paused, at cap) come first, exactly as Postgres would drop them.
 */
export function buildFanout(sa: SampleNetworkAsk): SampleFanoutRow[] {
  const askBack = new Map(sa.ask_back);
  const declineCode = new Map<string, 'stage' | 'proof' | 'region'>();
  for (const code of ['stage', 'proof', 'region'] as const) for (const label of sa.decline[code] ?? []) declineCode.set(label, code);
  return SAMPLE_MEMBERS.map((m): SampleFanoutRow => {
    const base = { label: m.label, city: m.city, cap: m.cap, used: m.used };
    if (m.paused) return { ...base, state: 'na', na: 'paused', reason_code: null, cited: null, question: null };
    if (m.used >= m.cap) return { ...base, state: 'na', na: 'at_cap', reason_code: null, cited: null, question: null };
    if (sa.accept.includes(m.label)) return { ...base, state: 'accept', na: null, reason_code: 'match', cited: memberCitation(m), question: null };
    const q = askBack.get(m.label);
    if (q) return { ...base, state: 'ask_back', na: null, reason_code: 'proof', cited: null, question: q };
    return { ...base, state: 'decline', na: null, reason_code: declineCode.get(m.label) ?? 'topic', cited: null, question: null };
  });
}

/** Expected fan-outs for the three sample asks, keyed by sample ask id. */
export const SAMPLE_FANOUTS: Readonly<Record<SampleNetworkAskId, SampleFanoutRow[]>> = {
  sa_eng: buildFanout(SAMPLE_NETWORK_ASKS.engineer),
  sa_health: buildFanout(SAMPLE_NETWORK_ASKS.health),
  sa_founder: buildFanout(SAMPLE_NETWORK_ASKS.founder),
};
