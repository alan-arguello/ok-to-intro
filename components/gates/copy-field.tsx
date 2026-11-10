'use client';

import { useState } from 'react';
import { Button } from '@/components/kit/button';
import { copyText } from '@/components/kit/code-block';

/** A read-only link with a Copy button (personal gates: the public link and the private inbox link). */
export function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gate-copy">
      <input className="input" id={id} readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <Button
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }
        }}
        aria-live="polite"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
