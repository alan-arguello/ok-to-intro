// PLACEHOLDER (foundation): S2 owns this file and replaces it. Kept minimal so the route exists during the build.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await params;
  return (
    <div className="container container--col">
      <header className="page-head page-head--left">
        <h1 className="title">Your ask</h1>
        <p className="lede">This page is being built.</p>
      </header>
    </div>
  );
}
