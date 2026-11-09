/** Integer-paise arithmetic for the UI demo. Convert only at display boundaries. */
export type Paise = number;
export const rupees = (value: number): Paise => Math.round(value * 100);
export const sumPaise = (values: Paise[]): Paise => values.reduce((a, b) => a + b, 0);
export const inr = (value: Paise, compact = false): string => {
  const amount = value / 100;
  if (compact && Math.abs(amount) >= 10000000) return "₹" + (amount / 10000000).toFixed(2) + "Cr";
  if (compact && Math.abs(amount) >= 100000) return "₹" + (amount / 100000).toFixed(1) + "L";
  if (compact && Math.abs(amount) >= 1000) return "₹" + (amount / 1000).toFixed(1) + "K";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
};
export const gstAmount = (taxablePaise: Paise, ratePct: number): Paise => Math.round(taxablePaise * ratePct / 100);
export function validateJournal(lines: { debit: Paise; credit: Paise }[]) {
  const debit = sumPaise(lines.map((line) => line.debit));
  const credit = sumPaise(lines.map((line) => line.credit));
  return { debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0 };
}
export const mask = (value: string, start = 2, end = 3) =>
  value.length <= start + end ? "•".repeat(value.length) : value.slice(0, start) + "•".repeat(value.length - start - end) + value.slice(-end);
