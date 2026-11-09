import { fmtUsd } from '@/lib/oti/text';

/** A constant price as written: 0.00016 → “$0.00016” (fmtUsd rounds to 3 decimals and would print $0.000). */
export function fmtUsdConst(n: number): string {
  return `$${n}`;
}

/** An “about” amount: 0.32 → “$0.32”; 0.00528 → “$0.005”; 0.0019 → “$0.002”; 0 → “$0”. */
export function fmtUsdAbout(n: number): string {
  if (n <= 0) return '$0';
  if (n >= 0.01) return fmtUsd(n);
  return `$${Number(n.toPrecision(1))}`;
}
