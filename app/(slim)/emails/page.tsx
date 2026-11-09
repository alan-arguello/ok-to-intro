import type { Metadata } from 'next';
import Link from 'next/link';
import { SampleTag } from '@/components/kit/pills';
import { SlimPage } from '@/components/site/slim-page';
import { SAMPLE_EMAILS } from '@/lib/emails/sample';
import '@/styles/offer.css';

/** `/emails` (owner R): every email the product sends, rendered from the real templates with SAMPLE data. */

export const metadata: Metadata = {
  title: 'Sample emails',
  description: 'Every email OK to Intro sends, rendered from the real templates with fictional data. Nothing is sent from here.',
};

export default function SampleEmailsIndex() {
  return (
    <SlimPage meta="Sample emails" mainClassName="container mail-main">
      <header className="page-head page-head--left">
        <h1 className="title">Sample emails</h1>
        <p className="lede">
          Every email the product sends, rendered from the real templates with fictional people. Plain text is always sent; each button opens a page where you
          confirm, so nothing happens from an email.
        </p>
      </header>
      <p className="mail-sample">
        <SampleTag />
        No email is sent from these pages.
      </p>
      <div className="list mail-index">
        {SAMPLE_EMAILS.map((e) => (
          <Link key={e.kind} className="row" href={`/emails/${e.kind}`}>
            <span className="row__name">{e.title}</span>
            <span className="row__body">{e.description}</span>
          </Link>
        ))}
      </div>
    </SlimPage>
  );
}
