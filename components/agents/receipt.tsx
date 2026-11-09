import { T, TraceLine } from '@/components/kit/blocks';
import { receiptSpans } from '@/lib/receipts';
import type { TranscriptRow } from './examples';

/**
 * Receipts and transcripts on the web, from the same text the MCP server returns (lib/receipts.ts): one `.ln` per
 * line, labels, fences and next: lines dimmed, “people interrupted” and “reach” in the attention colour, URLs as links.
 * Server components (no hooks): the /agents page renders them at build.
 */

export function ReceiptLine({ line, className }: { line: string; className?: string }) {
  return (
    <TraceLine className={className}>
      {receiptSpans(line).map((s, i) => (s.tone ? <T key={i} tone={s.tone}>{s.text}</T> : <span key={i}>{s.text}</span>))}
    </TraceLine>
  );
}

/** The lines of one receipt (or an error block), for a `<pre class="trace">`. */
export function ReceiptLines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <ReceiptLine key={i} line={l} />
      ))}
    </>
  );
}

/** A Claude Code transcript: the user's lines, Claude's, tool calls, receipts (indented), options and prompts. */
export function TranscriptLines({ rows }: { rows: readonly TranscriptRow[] }) {
  return (
    <>
      {rows.map((r, i) => {
        switch (r.kind) {
          case 'B':
            return <TraceLine key={i}> </TraceLine>;
          case 'U':
            return (
              <TraceLine key={i} className="ag-u">
                {'> '}
                {r.text}
              </TraceLine>
            );
          case 'C':
            return <TraceLine key={i}>{`⏺ ${r.text}`}</TraceLine>;
          case 'T':
            return (
              <TraceLine key={i} className="t-dim">
                {`⏺ ${r.text}`}
              </TraceLine>
            );
          case 'R':
            return <ReceiptLine key={i} line={r.text} className="ag-r" />;
          case 'O':
            return (
              <TraceLine key={i} className="ag-r">
                {r.text}
              </TraceLine>
            );
          case 'P':
            return (
              <TraceLine key={i} className="ag-r t-wait">
                {r.text}
              </TraceLine>
            );
          case 'H':
            return (
              <TraceLine key={i} className="t-dim">
                {r.text}
              </TraceLine>
            );
          case 'S':
            return (
              <TraceLine key={i}>
                <T tone="dim">$ </T>
                {r.text}
              </TraceLine>
            );
          default:
            return <TraceLine key={i}>{r.text}</TraceLine>;
        }
      })}
    </>
  );
}
