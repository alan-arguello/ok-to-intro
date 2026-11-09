/**
 * One cost constant for every cost string (How, playground meta and trace, board), ux-spec Revision 2.
 * $0.00016 per gate call on claude-haiku-5-5 is an ESTIMATE from the published prices (tech.md) until
 * `npm run bench` measures real usage; live runs always report the cost measured from token usage instead.
 */

import { MODELS } from '@/lib/site';

export const COST = {
  perGate: 0.00016,
  model: MODELS.gate,
  /** True until scripts/bench-gates.ts replaces the estimate with a measured mean. */
  estimate: true,
} as const;

/** About $0.002 for 12 gates (“the 12 sample asks cost $0.0019”). */
export function estimatedCost(gates: number): number {
  return COST.perGate * gates;
}
