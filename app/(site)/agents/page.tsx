import type { Metadata } from 'next';
import { AgentsPage } from '@/components/agents/agents-page';
import { AGENTS_COPY } from '@/components/agents/copy';
import { PRODUCT_NAME } from '@/lib/site';
import '@/styles/agents.css';

/**
 * S6 · `/agents` (ux-spec S6): install OK to Intro in Claude Code, see what its tools return. Static: the receipts are
 * rendered at build from SAMPLE data by the same formatter the MCP server uses; the tabs and Copy buttons hydrate.
 */
export const dynamic = 'force-static';

const TITLE = `Agents · ${PRODUCT_NAME}`;

export const metadata: Metadata = {
  title: 'Agents',
  description: AGENTS_COPY.description,
  alternates: { canonical: '/agents' },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: '/agents', title: TITLE, description: AGENTS_COPY.description },
  twitter: { card: 'summary_large_image', title: TITLE, description: AGENTS_COPY.description },
};

export default function Page() {
  return <AgentsPage />;
}
