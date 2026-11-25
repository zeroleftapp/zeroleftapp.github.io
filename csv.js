// ===== CSV and parsing helpers =====
// Small pure functions (no page access), used by import and export.

// Turn CSV text into rows of cells. Handles quoted cells with commas,
// line breaks and "" inside them, Windows line endings and a leading BOM.
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row);
      row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  // Drop completely empty lines
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Turn rows of values into CSV text. Cells that a spreadsheet could run
// as a formula (starting with = + - @) get a leading ' to keep them as text.
function toCSV(rows) {
  return rows.map((row) => row.map((value) => {
    let s = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\r\n");
}

// Money text -> signed cents. The ONE place where the app reads amounts
// (budget fields, expense form and CSV import all use it).
// Both comma and dot work as the decimal separator:
//   "33,5" and "33.5"           -> 3350
//   "1,234.56" (US)             -> 123456
//   "1 234,56" / "1.234,56" (EU) -> 123456
//   "1,234" / "1.234"           -> 123400 (3 digits after = thousands)
//   "$45", "-$12", "(45.00)"    -> 4500, -1200, -4500
// Rule: if the LAST comma/dot has 1–2 digits after it, it's the decimal
// separator; other commas, dots and spaces are thousands separators.
// Returns null when the text isn't an amount.
function parseAmount(text) {
  let s = String(text).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−]/.test(s)) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[$\s  ]/g, ""); // $ and spaces (also non-breaking)
  if (/^[-−]/.test(s)) { negative = !negative; s = s.slice(1); } // "$-12"
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return null; // only digits , . left

  let whole = s, cents = "00";
  const last = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (last !== -1) {
    const after = s.slice(last + 1);
    if (after.length <= 2) {
      // Decimal separator ("33," while typing counts as 33)
      whole = s.slice(0, last);
      cents = (after + "00").slice(0, 2);
    }
    // 3 digits after: thousands separator, handled below
  }

  // Whole part: plain digits, or digits grouped by 3 with ONE kind of
  // separator ("1,234,567" or "1.234.567"), different from the decimal one.
  const decimalSep = whole.length < s.length ? s[last] : "";
  if (whole === "") whole = "0"; // ".5" -> 0.50
  if (!/^\d+$/.test(whole)) {
    const m = whole.match(/^\d{1,3}([.,])\d{3}(\1\d{3})*$/);
    if (!m || m[1] === decimalSep) return null;
    whole = whole.replace(/[.,]/g, "");
  }
  if (!/^\d{2}$/.test(cents)) return null;

  const value = Number(whole) * 100 + Number(cents);
  return negative ? -value : value;
}

// Date text -> "YYYY-MM-DD", or null if it can't be read.
// Understands 2026-11-25, 11/25/2026, 11/25/26 and "Nov 25, 2026".
function parseDate(text) {
  const s = String(text).trim();
  let y, m, d;
  let match;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [y, m, d] = [match[1], match[2], match[3]].map(Number);
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    [m, d, y] = [match[1], match[2], match[3]].map(Number);
    if (y < 100) y += 2000;
  } else {
    const parsed = new Date(s);
    if (!s || isNaN(parsed)) return null;
    [y, m, d] = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }
  // Reject impossible dates like 2/31
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return null;
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
