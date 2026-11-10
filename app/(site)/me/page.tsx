import { redirect } from 'next/navigation';

/** The site is a demo with no accounts: /me goes to the composer. (components/member/me-view.tsx is unlinked.) */
export default function MePage(): never {
  redirect('/');
}
