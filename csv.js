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

// Money text -> signed cents. "$1,234.56" -> 123456, "(45.00)" -> -4500,
// "-12" -> -1200. Returns null when it isn't a number.
function parseAmount(text) {
  let s = String(text).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
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
