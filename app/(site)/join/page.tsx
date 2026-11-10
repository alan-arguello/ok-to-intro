import { redirect } from 'next/navigation';

/** The site is a demo with no sign-in: /join goes to the composer. (components/member/join-view.tsx is unlinked.) */
export default function JoinPage(): never {
  redirect('/');
}
