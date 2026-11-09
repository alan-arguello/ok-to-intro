// @vitest-environment jsdom
/**
 * /agents (S6): the static markup the page ships (install commands from lib/site.ts, the 9 tools and their tags, the
 * honest captions, receipts from the formatter) and its behaviour in a browser (tabs with arrow keys and the URL,
 * Copy with the clipboard and one announcement).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsPage } from '@/components/agents/agents-page';
import { AGENTS_COPY } from '@/components/agents/copy';
import { BANNED_COPY } from '@/lib/oti/text';
import { INSTALL_MCP_COMMAND, INSTALL_PLUGIN_COMMAND, INSTALL_PLUGIN_TWO_STEP } from '@/lib/site';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/agents');
});

describe('the static page', () => {
  const html = renderToStaticMarkup(<AgentsPage />);
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const text = doc.body.textContent ?? '';

  it('has the H1, the lede and one primary per install tab', () => {
    expect(doc.querySelector('h1')?.textContent).toBe('Use it from Claude Code');
    expect(doc.querySelector('.lede')?.textContent).toBe(AGENTS_COPY.lede);
    const primaries = [...doc.querySelectorAll('[data-primary]')];
    expect(primaries.map((b) => b.getAttribute('aria-label'))).toEqual(['Copy the plugin install command', 'Copy the MCP command']);
    // Only the plugin tab is visible in the static HTML (the MCP panel is hidden), so one primary shows per view.
    expect(primaries[1]?.closest('[role=tabpanel]')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows the install commands built from lib/site.ts', () => {
    const codes = [...doc.querySelectorAll('.code > code')].map((c) => c.textContent);
    expect(codes).toEqual([INSTALL_PLUGIN_COMMAND, ...INSTALL_PLUGIN_TWO_STEP, INSTALL_MCP_COMMAND]);
  });

  it('lists the 9 tools with their access and approval notes', () => {
    const rows = [...doc.querySelectorAll('.ag-tool')];
    expect(rows.map((r) => r.querySelector('.ag-tool__name')?.textContent)).toEqual(['try_rules', 'draft_ask', 'send_ask', 'answer_question', 'my_asks', 'pending_for_me', 'respond', 'set_rules', 'record_outcome']);
    const tags = (name: string) => [...(rows.find((r) => r.querySelector('.ag-tool__name')?.textContent === name)?.querySelectorAll('.tag') ?? [])].map((t) => t.textContent);
    expect(tags('try_rules')).toEqual(['Open']);
    expect(tags('send_ask')).toEqual(['Token', 'Sample: open']);
    expect(tags('answer_question')).toEqual(['Token', 'Sample: open']);
    expect(tags('respond')).toEqual(['Token']);
    expect(rows.filter((r) => r.querySelector('.ag-tool__note')).map((r) => r.querySelector('.ag-tool__name')?.textContent)).toEqual(['send_ask', 'answer_question', 'respond']);
    // Each example disclosure names its tool for screen readers.
    expect(rows.map((r) => r.querySelector('summary')?.textContent)).toEqual(rows.map((r) => `Example result for ${r.querySelector('.ag-tool__name')?.textContent}`));
    expect(text).toContain('9 tools: 2 open, 7 with your token (send_ask and answer_question also work without one on SAMPLE)');
  });

  it('labels the transcripts honestly and tags the section SAMPLE', () => {
    expect(text).toContain(AGENTS_COPY.transcriptsCaption);
    expect(text).not.toMatch(/Recorded transcripts/);
    expect(doc.querySelector('.ag-demo-head .tag')?.textContent).toBe('Sample');
    expect(text).toContain('Show the rest (the missing parts, send_ask, answer_question)');
  });

  it('renders every receipt from the formatter: SAMPLE in line 1, nothing invented', () => {
    const traces = [...doc.querySelectorAll('pre.trace')].map((p) => p.textContent ?? '');
    expect(traces.some((t) => t.includes('ok-to-intro · try_rules · 12 SAMPLE asks · cap 2'))).toBe(true);
    expect(traces.some((t) => t.includes('ok-to-intro · offer o_3Fp9 · OK to intro · SAMPLE'))).toBe(true);
    expect(text).not.toMatch(/\b2\.1 s\b|\b0\.8 s\b|\b1\.9 s\b/);
  });

  it('shows the hook rules and at most 3 example lines', () => {
    expect([...doc.querySelectorAll('.ag-hook .row')].map((r) => r.textContent)).toEqual(AGENTS_COPY.hookRules);
    expect(doc.querySelectorAll('.ag-hook-tr .ln')).toHaveLength(3);
  });

  it('uses curly quotes and none of the banned words in its own copy', () => {
    for (const value of Object.values(AGENTS_COPY).flat()) {
      expect(value).not.toMatch(/'/);
      for (const banned of BANNED_COPY) expect(value).not.toMatch(banned);
    }
  });
});

describe('in the browser', () => {
  it('switches tabs with clicks and arrow keys and keeps the choice in the URL', () => {
    render(<AgentsPage />);
    const mcp = screen.getByRole('tab', { name: 'MCP only' });
    fireEvent.click(mcp);
    expect(mcp.getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?tab=mcp');
    expect(screen.getByRole('button', { name: 'Copy the MCP command' }).closest('[role=tabpanel]')?.hasAttribute('hidden')).toBe(false);

    const ask = screen.getByRole('tab', { name: 'Ask' });
    fireEvent.keyDown(ask, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Get asked' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Get asked' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Get asked' }), { key: 'End' });
    expect(window.location.search).toBe('?tab=mcp&demo=try');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Try your rules' }), { key: 'Home' });
    expect(window.location.search).toBe('?tab=mcp');
  });

  it('opens the tab a link names', () => {
    window.history.replaceState(null, '', '/agents?demo=asked');
    render(<AgentsPage />);
    expect(screen.getByRole('tab', { name: 'Get asked' }).getAttribute('aria-selected')).toBe('true');
  });

  it('copies a command and says so once', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    try {
      render(<AgentsPage />);
      const button = screen.getByRole('button', { name: 'Copy the plugin install command' });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(writeText).toHaveBeenCalledWith(INSTALL_PLUGIN_COMMAND);
      expect(button.textContent).toBe('Copied');
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(button.textContent).toBe('Copy');
    } finally {
      vi.useRealTimers();
    }
  });
});
