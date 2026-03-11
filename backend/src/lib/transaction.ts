import type { Decimal } from '@prisma/client/runtime/library';

/**
 * Amount to use in EGP aggregations (sums, budgets, charts).
 * For non-EGP transactions, use egp_value when set; otherwise use the original amount.
 */
export function effectiveAmount(t: {
  amount: Decimal;
  egpValue?: Decimal | null;
}): number {
  if (t.egpValue != null) {
    return Number(t.egpValue);
  }
  return Number(t.amount);
}
