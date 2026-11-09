import test from "node:test";
import assert from "node:assert/strict";
import {
  hashHexToUuid,
  parseBankStatementDate,
  parseCsv,
  parseRupeeMinor,
  sha256Hex,
} from "../src/lib/csv.ts";

test("CSV parser handles BOM, commas, escaped quotes and CRLF", () => {
  const source = '\uFEFFDate,Narration,Debit,Credit\r\n09/11/2026,"UPI, Vendor ""A""",125.50,\r\n10/11/2026,NEFT receipt,,2500\r\n';
  assert.deepEqual(parseCsv(source), [
    ["Date", "Narration", "Debit", "Credit"],
    ["09/11/2026", 'UPI, Vendor "A"', "125.50", ""],
    ["10/11/2026", "NEFT receipt", "", "2500"],
  ]);
});

test("CSV parser rejects unterminated quoted fields", () => {
  assert.throws(() => parseCsv('Date,Description\n2026-11-09,"missing end'), /unterminated/i);
});

test("bank statement dates support ISO and Indian day-first formats", () => {
  assert.equal(parseBankStatementDate("2026-11-09"), "2026-11-09");
  assert.equal(parseBankStatementDate("09/11/2026"), "2026-11-09");
  assert.equal(parseBankStatementDate("09-11-2026"), "2026-11-09");
  assert.equal(parseBankStatementDate("31/02/2026"), null);
  assert.equal(parseBankStatementDate("11/09/26"), null);
});

test("INR amounts convert to integer paise without accepting negatives or extra precision", () => {
  assert.equal(parseRupeeMinor("₹1,25,000.50"), 12500050);
  assert.equal(parseRupeeMinor("250.00"), 25000);
  assert.equal(parseRupeeMinor("0"), 0);
  assert.equal(parseRupeeMinor(""), 0);
  assert.equal(parseRupeeMinor("-100.00"), null);
  assert.equal(parseRupeeMinor("100.123"), null);
  assert.equal(parseRupeeMinor("not-money"), null);
});

test("file digests produce deterministic UUID-shaped import identifiers", async () => {
  const digest = await sha256Hex("aurel-bank-statement");
  assert.equal(digest.length, 64);
  assert.equal(await sha256Hex("aurel-bank-statement"), digest);
  const id = hashHexToUuid(digest);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(hashHexToUuid(digest), id);
});
