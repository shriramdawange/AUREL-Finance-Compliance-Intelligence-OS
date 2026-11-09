export type CsvRow = string[];

export function parseCsv(input: string): CsvRow[] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

export function parseBankStatementDate(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  let year: number;
  let month: number;
  let day: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  const indian = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(input);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (indian) {
    day = Number(indian[1]);
    month = Number(indian[2]);
    year = Number(indian[3]);
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return date.toISOString().slice(0, 10);
}

/** Parse an unsigned INR amount into paise. Returns null for invalid or negative values. */
export function parseRupeeMinor(value: string): number | null {
  const input = value.trim();
  if (!input) return 0;

  const cleaned = input
    .replace(/[₹$€£]/g, "")
    .replace(/\bINR\b/gi, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

export async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof value === "string") {
    const encoded = new TextEncoder().encode(value);
    const copy = new Uint8Array(encoded.length);
    copy.set(encoded);
    buffer = copy.buffer;
  } else {
    buffer = value;
  }

  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Deterministic UUID derived from a SHA-256 hex digest (UUID v5-shaped namespace identifier). */
export function hashHexToUuid(hash: string): string {
  if (!/^[0-9a-f]{32,}$/i.test(hash)) throw new Error("A SHA-256 hexadecimal digest is required.");
  const chars = hash.slice(0, 32).toLowerCase().split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][Number.parseInt(chars[16], 16) % 4];
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
