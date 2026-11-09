// PLACEHOLDER (foundation): R owns this file and replaces it. Kept minimal so the route exists during the build.
import { SlimPage } from '@/components/site/slim-page';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  await params;
  return (
    <SlimPage mainClassName="container container--narrow">
      <header className="page-head page-head--left">
        <h1 className="title">How useful was the call?</h1>
        <p className="lede">This page is being built.</p>
      </header>
    </SlimPage>
  );
}
