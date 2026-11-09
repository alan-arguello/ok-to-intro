import type {
  CheckinEmailInput,
  EmailMessage,
  IntroEmailInput,
  OfferEmailInput,
  OutcomeNoteEmailInput,
  QuestionEmailInput,
  WithdrawnEmailInput,
} from '@/lib/types';

/**
 * Owner: R. Email templates: pure functions that return {subject, preheader, html, text, headers}
 * (ux-spec S4/S5; tech.md “Rendering”): plain text first; HTML 560 px, table layout, inline CSS, system fonts,
 * ink on white, under 20 KB, no images or tracking, light only (no color-scheme meta). Bulletproof link buttons
 * at least 48 px tall; the OK button is ink with a white label. Every button links to a page where the person
 * confirms; nothing happens from the email itself. Footers follow the recipient's role. BE2 sends them.
 *
 * STUB (foundation): signatures are final. The bodies below are deliberately plain (text-only HTML) until R
 * replaces them with the designed templates from prototype/emails/*.html.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function plain(subject: string, preheader: string, lines: string[], headers: Record<string, string> = {}): EmailMessage {
  const text = lines.join('\n');
  const html = `<!doctype html><html lang="en"><body><div style="display:none">${esc(preheader)}</div><pre style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap">${esc(text)}</pre></body></html>`;
  return { subject, preheader, html, text, headers };
}

/** S4 offer email to the member whose gate accepted. */
export function offerEmail(input: OfferEmailInput): EmailMessage {
  return plain(
    input.subject,
    `Matched your rule “${input.matched}” · ${input.nth} of your ${input.cap} this month · reply by ${input.reply_by_day}`,
    [
      `An ask matched your rules. It’s ${input.nth} of your ${input.cap} this month.`,
      '',
      input.title,
      `From ${input.asker.name}, ${input.asker.company} (${input.asker.stage}, ${input.asker.city})`,
      `Matched your rule: “${input.matched}”`,
      '',
      ...input.facts.map(([k, v]) => `${k}: ${v}`),
      '',
      `OK to intro: ${input.offer_url}?choice=ok`,
      `Answer in 2 lines: ${input.offer_url}?choice=answer`,
      `No: ${input.offer_url}?choice=no`,
      '',
      'Each button opens a page where you confirm. Nothing happens from this email.',
    ],
    { 'List-Unsubscribe': `<${input.footer.unsubscribe_post_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  );
}

/** “Intro: Lucía Ferrer (Orvella Health) and Ana Ruiz (public hospital procurement)” (the parenthetical is optional). */
export function introSubject(input: Pick<IntroEmailInput, 'asker' | 'member' | 'member_context'>): string {
  const member = input.member_context ? `${input.member.name} (${input.member_context})` : input.member.name;
  return `Intro: ${input.asker.name} (${input.asker.company}) and ${member}`;
}

/** S5 intro email to both people (To: both; Reply-To: both; the service is not in the thread). */
export function introEmail(input: IntroEmailInput): EmailMessage {
  return plain(introSubject(input), `Reply all to pick a time.`, [
    `${input.member.name} · ${input.member.one_line}`,
    `${input.asker.name} · ${input.asker.company} (${input.asker.stage}, ${input.asker.city})`,
    '',
    `${input.asker.first}, ${input.member.first}: you both said yes, so here is the intro.`,
  ]);
}

/** To the member who held the offer when the asker withdrew the ask (no buttons; nothing to do). */
export function withdrawnEmail(input: WithdrawnEmailInput): EmailMessage {
  return plain(`No longer needed: ${input.title}`, `${input.asker_first} withdrew this ask. Nothing to do.`, [
    `${input.asker_first} withdrew the ask “${input.title}” on ${input.withdrawn_on}. Nothing to do.`,
    `It still counted as ${input.nth} of your ${input.cap} this month.`,
  ]);
}

/** S5 check-in emails (+1 day to each person, +14 days to the asker). */
export function checkinEmail(input: CheckinEmailInput): EmailMessage {
  const subject = input.kind === 'd14' ? `What came of the intro to ${input.other_first}?` : `Did you and ${input.other_first} talk?`;
  return plain(subject, 'One tap opens a page where you confirm.', [subject, input.checkin_url]);
}

/** The email to a web-only asker when a gate asks a question (Later in ux-spec §10; built only if time allows). */
export function questionEmail(input: QuestionEmailInput): EmailMessage {
  return plain(`A gate has one question about “${input.ask_subject}”`, input.question.text, [input.question.text, input.ask_url]);
}

/** S5 outcome note to the member when the asker reports a useful outcome (Should). */
export function outcomeNoteEmail(input: OutcomeNoteEmailInput): EmailMessage {
  return plain(`What came of your intro to ${input.asker_first}`, 'Thanks for the 20 minutes.', [`${input.asker_first} reported an outcome from your intro (${input.reported_on}). Thanks for the 20 minutes.`]);
}
