'use client';

import { useState } from 'react';
import { Button } from '@/components/kit/button';
import { Notice } from '@/components/kit/surfaces';
import { GATE_STORAGE_KEY } from '@/lib/oti/personal-gate';

type Action = (slug: string, token: string) => Promise<{ ok: boolean }>;

/** “Delete this gate and all asks”: confirm, POST with the owner token, cascade. */
export function DeleteGate({ slug, token, action }: { slug: string; token: string; action: Action }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  if (state === 'done') {
    return <Notice title="Deleted.">Your gate and every ask sent to it are gone. The links no longer work.</Notice>;
  }
  return (
    <div className="stack">
      <Button
        variant="danger"
        busy={state === 'busy'}
        disabled={state === 'busy'}
        onClick={async () => {
          if (!window.confirm('Delete this gate and every ask sent to it? This can’t be undone.')) return;
          setState('busy');
          try {
            const res = await action(slug, token);
            if (res.ok) {
              try {
                const saved = JSON.parse(window.localStorage.getItem(GATE_STORAGE_KEY) ?? 'null') as { slug?: string } | null;
                if (saved?.slug === slug) window.localStorage.removeItem(GATE_STORAGE_KEY);
              } catch {
                /* storage blocked */
              }
            }
            setState(res.ok ? 'done' : 'failed');
          } catch {
            setState('failed');
          }
        }}
      >
        Delete this gate and all asks
      </Button>
      {state === 'failed' ? <Notice kind="error">That didn’t go through. Nothing was deleted. Try again.</Notice> : null}
    </div>
  );
}
