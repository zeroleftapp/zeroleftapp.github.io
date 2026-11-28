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
    { date: "Date", amount: "Amount", merchant: "Merchant", item: "Budget Item", group: "Budget Group", type: "", note: "" });
  check("import detects negative expenses", looksNegative(records, map), true);
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

  // --- EveryDollar's (likely) real export format ---
  // Group, Item, Type, Date, Merchant, Account, Amount, Note; MM/DD/YYYY;
  // spending negative; a refund is a positive "Expense" row.
  const edCsv =
    "Group,Item,Type,Date,Merchant,Account,Amount,Note\n" +
    'Income,Paycheck 1,Income,08/01/2026,Acme Corp,Checking,"2,400.00",\n' +
    "Food,Groceries,Expense,08/02/2026,Kroger,Checking,-87.45,weekly shop\n" +
    'Housing,Rent,Expense,08/01/2026,Oak Apartments,Checking,"-1,250.00",\n' +
    "Food,Groceries,Expense,08/20/2026,Kroger,Checking,12.99,refund\n";
  const edRows = parseCSV(edCsv);
  const edRecords = edRows.slice(1).map((cells) => {
    const r = {};
    edRows[0].forEach((h, i) => { r[h] = cells[i] || ""; });
    return r;
  });
  const edMap = guessColumns(edRows[0]);
  check("EveryDollar format: columns", edMap,
    { date: "Date", amount: "Amount", merchant: "Merchant", item: "Item", group: "Group", type: "Type", note: "Note" });
  const edRead = readImportRows(edRecords, edMap, looksNegative(edRecords, edMap));
  check("EveryDollar format: expenses (refund negative)",
    edRead.expenses.map((e) => [e.date, e.itemName, e.amount, e.note]),
    [["2026-08-02", "Groceries", 8745, "weekly shop"], ["2026-08-01", "Rent", 125000, ""], ["2026-08-20", "Groceries", -1299, "refund"]]);
  check("EveryDollar format: income", edRead.incomes.map((i) => [i.date, i.amount]), [["2026-08-01", 240000]]);

  // Type column decides even if every amount is positive
  const posRecords = [
    { Type: "Income", Date: "08/01/2026", Amount: "100" },
    { Type: "Expense", Date: "08/02/2026", Amount: "30" },
  ];
  const posRead = readImportRows(posRecords, { date: "Date", amount: "Amount", type: "Type" }, false);
  check("Type column with positive amounts", [posRead.incomes.length, posRead.expenses.map((e) => e.amount)], [1, [3000]]);

  // Budget summary export is recognized (and skipped by the import)
  check("budget summary detected", isBudgetSummaryFile(["Group", "Item", "Planned", "Spent", "Remaining"]), true);
  check("summary with only Planned/Spent", isBudgetSummaryFile(["Group", "Item", "Planned", "Spent"]), true);
  check("transactions not a summary", isBudgetSummaryFile(edRows[0]), false);

  // --- Bank / other app files (no EveryDollar detection) ---
  function bank(csvText) {
    const t = tableFromRows(parseCSV(csvText));
    const m = guessBankColumns(t.headers, t.records);
    const r = readImportRows(t.records, m, looksNegative(t.records, m));
    return { t, m, r };
  }
  // One Amount column, spending negative (Chase style)
  const b1 = bank(
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
    "11/02/2026,11/03/2026,KROGER #412,Groceries,Sale,-87.45,\n" +
    "11/03/2026,11/04/2026,SHELL OIL 5741,Gas,Sale,-41.20,\n" +
    "11/08/2026,11/09/2026,NETFLIX.COM,Entertainment,Sale,-15.49,monthly\n" +
    '11/05/2026,11/05/2026,PAYROLL ACME CORP,,Deposit,"2,400.00",\n' +
    "11/12/2026,11/13/2026,KROGER #412,Groceries,Return,12.99,refund\n");
  check("bank: guesses", [b1.m.date, b1.m.amount, b1.m.merchant, b1.m.item, b1.m.type, b1.m.note],
    ["Transaction Date", "Amount", "Description", "", "", "Memo"]);
  check("bank: one amount column", [b1.r.expenses.map((e) => [e.merchant, e.amount]), b1.r.incomes.map((i) => i.amount)],
    [[["KROGER #412", 8745], ["SHELL OIL 5741", 4120], ["NETFLIX.COM", 1549]], [240000, 1299]]);
  // Note: without a Type column a positive "Return" counts as money in.

  // Separate Debit / Credit columns (Capital One style)
  const b2 = bank(
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n" +
    "2026-11-02,2026-11-03,1234,TARGET 00012,Merchandise,54.10,\n" +
    "2026-11-10,2026-11-10,1234,ONLINE PAYMENT,Payment/Credit,,500.00\n");
  check("bank: debit/credit guesses", [b2.m.amount, b2.m.moneyOut, b2.m.moneyIn], ["", "Debit", "Credit"]);
  check("bank: debit/credit amounts", [b2.r.expenses.map((e) => e.amount), b2.r.incomes.map((i) => i.amount)], [[5410], [50000]]);

  // Summary lines above the real header (Bank of America style)
  const b3 = bank(
    "Description,,Summary Amt.\n" +
    'Beginning balance as of 11/01/2026,,"1,000.00"\n\n' +
    "Date,Description,Amount,Running Bal.\n" +
    '11/01/2026,Beginning balance as of 11/01/2026,,"1,000.00"\n' +
    '11/02/2026,"WALMART, ANYTOWN",-63.12,936.88\n');
  check("bank: header after summary lines", b3.t.headers, ["Date", "Description", "Amount", "Running Bal."]);
  check("bank: balance row skipped", [b3.r.expenses.map((e) => e.amount), b3.r.invalid], [[6312], 1]);

  // No header row at all (Wells Fargo style)
  const b4 = bank(
    '"11/02/2026","-87.45","*","","KROGER #412"\n' +
    '"11/05/2026","2400.00","*","","PAYROLL ACME CORP"\n' +
    '"11/09/2026","-29.99","*","","AMAZON MKTPLACE"\n');
  check("bank: no header row", [b4.t.headers.length, b4.t.records.length], [5, 3]);
  check("bank: guessed from contents", [b4.m.date, b4.m.amount, b4.m.merchant], ["Column 1", "Column 2", "Column 5"]);
  check("bank: no-header amounts", [b4.r.expenses.map((e) => e.amount), b4.r.incomes.map((i) => i.amount)], [[8745, 2999], [240000]]);

  // Imported bank months are marked "CSV", not "EveryDollar"
  const bankData = { months: {}, transactions: [] };
  applyImport(bankData, b1.r.expenses, b1.r.incomes, () => "b" + (++n), "CSV");
  check("bank: month source", bankData.months["2026-11"].importedFrom, "CSV");
  check("sign tie counts as negative", looksNegative([{ A: "-63.12" }, { A: "2,400.00" }], { amount: "A" }), true);
  check("date-like cells", ["11/02/2026", "2026-11-02", "Nov 2, 2026", "-45.10", "12", "*"].map(looksLikeDate),
    [true, true, true, false, false, false]);

  // --- Recurring bills ---
  const rent = { id: "r", itemId: "rentItem", name: "Rent", amount: 125000, due: "2026-11-01", every: 1, group: "Housing" };
  const car = { id: "c", itemId: "carItem", name: "Car insurance", amount: 60000, due: "2026-12-31", every: 3, group: "" };
  const prime = { id: "p", itemId: "primeItem", name: "Prime", amount: 13900, due: "2027-01-15", every: 12, group: "Personal" };
  check("bill monthly", ["2026-10", "2026-11", "2027-02"].map((k) => billDueDate(rent, k)), [null, "2026-11-01", "2027-02-01"]);
  check("bill every 3 months, 31st", ["2026-12", "2027-01", "2027-03", "2027-06"].map((k) => billDueDate(car, k)),
    ["2026-12-31", null, "2027-03-31", "2027-06-30"]);
  check("bill yearly", ["2027-01", "2027-02", "2028-01"].map((k) => billDueDate(prime, k)), ["2027-01-15", null, "2028-01-15"]);

  const dec = { incomes: [], groups: [{ id: "g1", name: "Housing", items: [] }] };
  applyBillsToMonth(dec, "2026-12", [rent, car, prime], () => "new" + (++n));
  check("bills fill the plan", dec.groups.map((g) => [g.name, g.items.map((i) => [i.name, i.planned])]),
    [["Housing", [["Rent", 125000]]], ["Bills", [["Car insurance", 60000]]]]);
  applyBillsToMonth(dec, "2027-01", [rent, car, prime], () => "new" + (++n)); // same plan used as January
  check("bill not due -> planned 0", dec.groups.map((g) => g.items.map((i) => i.planned)), [[125000], [0], [13900]]);

  const months = { "2026-11": { incomes: [{ date: "2026-11-15" }, { date: "2026-11-30" }, { date: "" }] } };
  check("next payday", [nextPayday(months, "2026-11-10"), nextPayday(months, "2026-11-15"), nextPayday(months, "2026-11-30")],
    ["2026-11-15", "2026-11-30", "2026-12-15"]);
  check("no income dates -> no payday", nextPayday({ "2026-11": { incomes: [{ date: "" }] } }, "2026-11-10"), null);
  const paidTx = [{ billId: "r", date: "2026-11-01" }, { billId: "r", date: "2026-12-01" }];
  check("upcoming before payday",
    upcomingBills([rent, car], [], "2026-11-20", "2026-12-15").map((u) => [u.bill.name, u.date, u.overdue]),
    [["Rent", "2026-11-01", true], ["Rent", "2026-12-01", false]]);
  check("paid bills drop out", upcomingBills([rent], paidTx, "2026-11-28", "2027-01-01").map((u) => u.date), []);
  check("over a year end", upcomingBills([car], [], "2026-12-20", "2027-01-05").map((u) => u.date), ["2026-12-31"]);

  return out;
}
