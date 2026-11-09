'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/components/kit/code-block';
import { announce } from '@/components/site/live-region';

/**
 * `.code`: an install command on ink with a “$ ” prompt and a Copy button (“Copied” for 1.5 s, announced once),
 * the kit's CodeBlock markup plus what /agents needs: the prototype's own accessible name for each button and
 * `data-primary` on the visible install command (⌘↵ copies it; 44 px tall via tokens.css). docs/requests/s6-agents.md
 * asks F to add both props to the kit's CodeBlock.
 */
export function CopyCommand({ command, label, primary }: { command: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="code">
      <code>{command}</code>
      <button
        className="btn"
        type="button"
        aria-label={copied ? undefined : label}
        data-primary={primary ? '' : undefined}
        onClick={async () => {
          if (await copyText(command)) {
            setCopied(true);
            announce('Copied');
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
