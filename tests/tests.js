// ===== Automatic tests for the parsing and import helpers =====
// Open tests/index.html in a browser to run them.
// runTests() returns lines like "ok   ..." or "FAIL ...".

function runTests() {
  const out = [];
  function check(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    out.push((g === w ? "ok   " : "FAIL ") + name + (g === w ? "" : "  got " + g + ", want " + w));
  }

  // --- parseAmount: comma or dot as decimal separator ---
  const amounts = [
    // the examples from the bug report
    ["33,5", 3350], ["33.5", 3350],
    ["1,234.56", 123456],
    ["1 234,56", 123456], ["1.234,56", 123456],
    // 1–2 digits after the last separator = decimals
    ["33,50", 3350], ["0,5", 50], [",5", 50], [".99", 99], ["12,", 1200],
    // 3 digits after = thousands
    ["1,234", 123400], ["1.234", 123400], ["1,234,567", 123456700], ["1.234.567,89", 123456789],
    // spaces, including the non-breaking ones from some spreadsheets
    ["1 234,56", 123456], ["  45 ", 4500],
    // signs and dollar signs (EveryDollar style)
    ["$1,234.56", 123456], ["-$45.10", -4510], ["$-45.10", -4510], ["(45.00)", -4500],
    ["+12", 1200], ["-0,5", -50], ["0", 0],
    // not amounts
    ["", null], ["abc", null], ["$", null], ["12.3456", null], ["1,2,5", null],
    ["1,234,56", null], ["1.234.56", null], ["12a", null],
  ];
  amounts.forEach(([text, want]) => check("parseAmount " + JSON.stringify(text), parseAmount(text), want));

  // --- CSV reading and writing ---
  check("parseCSV quotes, BOM, CRLF",
    parseCSV('﻿Date,Merchant,Amount\r\n11/2/2026,"Kroger, Inc","-1,045.10"\r\n\r\n11/3/2026,"Say ""hi""",12\n'),
    [["Date", "Merchant", "Amount"], ["11/2/2026", "Kroger, Inc", "-1,045.10"], ["11/3/2026", 'Say "hi"', "12"]]);
  check("toCSV round trip", parseCSV(toCSV([["a,b", 'q"x', "line\nbreak"]])), [["a,b", 'q"x', "line\nbreak"]]);
  check("toCSV blocks formulas", toCSV([["=SUM(A1)", "-12.5"]]), "'=SUM(A1),-12.5");

  // --- Dates ---
  check("parseDate ISO", parseDate("2026-11-05"), "2026-11-05");
  check("parseDate US", parseDate("11/5/2026"), "2026-11-05");
  check("parseDate short year", parseDate("1/31/26"), "2026-01-31");
  check("parseDate text", parseDate("Nov 25, 2026"), "2026-11-25");
  check("parseDate impossible", parseDate("2/31/2026"), null);

  // --- EveryDollar import, US and European amount formats ---
  const csv =
    "Date,Merchant,Amount,Budget Group,Budget Item\n" +
    '10/1/2026,Paycheck,"$2,400.00",,\n' +
    '10/3/2026,Kroger,"-$1,045.10",Food,Groceries\n' +
    '10/9/2026,Aldi,"-20,5",Food,Groceries\n' +
    '10/12/2026,Shell,"-1.234,56",Transportation,Gas\n' +
    "bad date,x,-1,,\n";
  const rows = parseCSV(csv);
  const headers = rows[0];
  const records = rows.slice(1).map((cells) => {
    const r = {};
    headers.forEach((h, i) => { r[h] = cells[i] || ""; });
    return r;
  });
  const map = guessColumns(headers);
  check("import guesses columns", map,
    { date: "Date", amount: "Amount", merchant: "Merchant", item: "Budget Item", group: "Budget Group" });
  check("import detects negative expenses", looksNegative(records, map.amount), true);
  const read = readImportRows(records, map, true);
  check("import amounts", read.expenses.map((e) => e.amount), [104510, 2050, 123456]);
  check("import income", read.incomes.map((i) => i.amount), [240000]);
  check("import skips bad rows", read.invalid, 1);

  let n = 0;
  const data = { months: {}, transactions: [] };
  applyImport(data, read.expenses, read.incomes, () => "id" + (++n));
  const oct = data.months["2026-10"];
  check("import plan = spent", oct.groups.map((g) => [g.name, g.items[0].name, g.items[0].planned]),
    [["Food", "Groceries", 106560], ["Transportation", "Gas", 123456]]);
  check("import income planned", oct.incomes.map((i) => i.planned), [240000]);

  return out;
}
