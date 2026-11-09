'use client';

import { useEffect, useRef, useState } from 'react';
import { announce } from '@/components/site/live-region';

/** Copies text to the clipboard; falls back to a hidden textarea. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * `.code`: a command on ink with a “$ ” prompt and a Copy button (“Copied” for 1.5 s, announced once).
 * Wraps on phones; never scrolls sideways.
 */
export function CodeBlock({ command, label = 'Copy' }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div className="code">
      <code>{command}</code>
      <button
        className="btn"
        type="button"
        aria-label={copied ? undefined : `${label}: ${command}`}
        onClick={async () => {
          if (await copyText(command)) {
            setCopied(true);
            announce('Copied');
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? 'Copied' : label}
      </button>
    </div>
  );
}
