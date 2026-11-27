// ===== CSV import logic (EveryDollar, banks and other apps) =====
// Pure functions (no page access): they take data in and give results back.
// Uses parseDate and parseAmount from csv.js.

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

// Does this cell look like a date? Stricter than parseDate alone, so
// numbers like "-45.10" are never mistaken for dates.
function looksLikeDate(cell) {
  const c = String(cell || "").trim();
  return (/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(c) || /^[a-z]{3,9}\.? \d{1,2},? \d{4}$/i.test(c)) &&
    !!parseDate(c);
}

// Turn parsed CSV rows into { headers, records }. Bank files are messy:
// - some start with summary lines before the real header row
//   (we use the first row that has a "date" column name),
// - some have no header row at all (the first row is already data);
//   then columns are called "Column 1", "Column 2", ...
function tableFromRows(rows) {
  const isData = (row) => row.some(looksLikeDate);
  let start = rows.findIndex((row, i) => i < 15 && !isData(row) && row.some((c) => /date/i.test(c)));
  if (start === -1) start = 0;
  let headers, body;
  if (rows.length && isData(rows[start])) {
    const width = Math.max(...rows.map((r) => r.length));
    headers = Array.from({ length: width }, () => "");
    body = rows.slice(start);
  } else {
    headers = (rows[start] || []).map((h) => h.trim());
    body = rows.slice(start + 1);
  }
  headers = headers.map((h, i) => h || "Column " + (i + 1));
  const records = body.map((cells) => {
    const r = {};
    headers.forEach((h, i) => { r[h] = cells[i] || ""; });
    return r;
  });
  return { headers, records };
}

// Guesses for a bank or another app's file. Only the basics (date,
// amount, description, note): the user checks and picks the rest.
// Some banks have separate "Debit" and "Credit" columns instead of one
// amount: those become moneyOut and moneyIn. Files without header names
// are guessed from what the cells look like.
function guessBankColumns(headers, records) {
  const low = (h) => h.trim().toLowerCase();
  const find = (test) => headers.find((h) => test(low(h))) || "";
  const map = {
    date: find((h) => h.includes("date") && !h.includes("post")) || find((h) => h.includes("date")),
    amount: find((h) => h.includes("amount") && !h.includes("balance")),
    moneyOut: find((h) => /debit|withdrawal|money out|paid out/.test(h)),
    moneyIn: find((h) => /credit|deposit|money in|paid in/.test(h)),
    merchant: find((h) => /description|payee|merchant|^name$|details/.test(h)),
    item: "", group: "", type: "",
    note: find((h) => /note|memo/.test(h)),
  };
  if (map.amount) { map.moneyOut = ""; map.moneyIn = ""; }

  // No usable names (e.g. "Column 1"): look at the first rows' contents
  const sample = records.slice(0, 10);
  const filled = (h) => sample.filter((r) => String(r[h] || "").trim() !== "");
  const used = () => Object.values(map);
  if (!map.date) {
    map.date = headers.find((h) => filled(h).length && filled(h).every((r) => looksLikeDate(r[h]))) || "";
  }
  if (!map.amount && !map.moneyOut && !map.moneyIn) {
    map.amount = headers.find((h) => !used().includes(h) && filled(h).length &&
      filled(h).every((r) => parseAmount(r[h]) !== null && /[.,]\d\d$|^-/.test(r[h].trim()))) || "";
  }
  if (!map.merchant) {
    // The column with the most text in it is usually the description
    let best = "", bestLen = 0;
    headers.forEach((h) => {
      if (used().includes(h)) return;
      const len = filled(h).reduce((sum, r) => sum + (/[a-z]/i.test(r[h]) ? r[h].length : 0), 0);
      if (len > bestLen) { best = h; bestLen = len; }
    });
    map.merchant = best;
  }
  return map;
}

// The amount of one row, from one Amount column or from separate
// money out / money in columns (out becomes negative, in positive).
function rowAmount(r, map) {
  if (map.amount) return parseAmount(r[map.amount] || "");
  const out = parseAmount(r[map.moneyOut] || "");
  const inn = parseAmount(r[map.moneyIn] || "");
  if (out) return -Math.abs(out);
  if (inn) return Math.abs(inn);
  return out === 0 || inn === 0 ? 0 : null;
}

// Guess which column is which from the header names.
// Returns header names (or "" when no good guess).
// EveryDollar's transaction export most likely has the columns
// Group, Item, Type, Date, Merchant, Account, Amount, Note
// (dates MM/DD/YYYY, spending negative). Other spellings like
// "Budget Item" or "Merchant Description" are recognized too.
function guessColumns(headers) {
  const find = (test) => headers.find((h) => test(h.trim().toLowerCase())) || "";
  return {
    date: find((h) => h.includes("date")),
    amount: find((h) => h.includes("amount") || h === "amt"),
    merchant: find((h) => /merchant|payee|description|^name$/.test(h)),
    item: find((h) => /item|category|budget/.test(h) && !h.includes("group")),
    group: find((h) => h.includes("group")),
    type: find((h) => h === "type" || h.includes("type")),
    note: find((h) => /note|memo/.test(h)),
  };
}

// EveryDollar also exports a budget summary (Group, Item, Planned, Spent,
// Remaining) with no dates. It isn't a list of transactions, so the
// import skips it and says so.
function isBudgetSummaryFile(headers) {
  const h = headers.map((x) => x.trim().toLowerCase());
  // Any of Planned / Spent / Remaining and no date column = a summary
  const budgetCols = ["planned", "spent", "remaining"].some((c) => h.includes(c));
  return budgetCols && !h.some((x) => x.includes("date"));
}

// Is this row income? With a Type column ("Income" / "Expense") or an
// "Income" budget group we trust that; otherwise we go by the amount's sign.
function rowIsIncome(r, map, amount, expensesNegative) {
  if (map.type) {
    const type = normName(r[map.type]);
    if (type) return /income|deposit|credit/.test(type);
  }
  if (map.group && normName(r[map.group]) === "income") return true;
  return expensesNegative ? amount > 0 : amount < 0;
}

// Are most expense amounts negative? Then expenses are the negative ones.
// (Only a first guess: the user sees the result and can change it.)
// map = { amount, type?, group? }. Rows that the Type column or an
// "Income" group mark as income are left out of the count.
function looksNegative(records, map) {
  if (!map.amount && (map.moneyOut || map.moneyIn)) return true; // see rowAmount
  let neg = 0, pos = 0;
  records.forEach((r) => {
    if (map.type && /income|deposit|credit/.test(normName(r[map.type]))) return;
    if (map.group && normName(r[map.group]) === "income") return;
    const a = rowAmount(r, map);
    if (a < 0) neg++;
    else if (a > 0) pos++;
  });
  // A tie counts as negative: most bank files show spending as minus
  return neg > 0 && neg >= pos;
}

// Turn file rows into clean expenses and incomes using the chosen columns.
// map = { date, amount, merchant, item, group, type, note } (header names;
// "" when not chosen). Instead of amount there can be moneyOut / moneyIn.
function readImportRows(records, map, expensesNegative) {
  // Separate out / in columns: rowAmount makes spending negative
  if (!map.amount && (map.moneyOut || map.moneyIn)) expensesNegative = true;
  const expenses = [];
  const incomes = [];
  let invalid = 0;
  records.forEach((r) => {
    const date = parseDate(r[map.date] || "");
    const amount = rowAmount(r, map);
    if (!date || amount === null || amount === 0) { invalid++; return; }
    if (rowIsIncome(r, map, amount, expensesNegative)) {
      // Money coming in, e.g. a paycheck
      incomes.push({
        date,
        amount: Math.abs(amount),
        name: String(r[map.merchant] || "").trim() || String(r[map.item] || "").trim() || "Income",
      });
      return;
    }
    expenses.push({
      date,
      // Spending is positive. A row with the opposite sign that is still an
      // expense (only possible with a Type column) is a refund: negative,
      // so it lowers what was spent.
      amount: expensesNegative ? -amount : amount,
      merchant: String(r[map.merchant] || "").trim(),
      itemName: String(r[map.item] || "").trim(),
      groupName: String(r[map.group] || "").trim(),
      note: String(r[map.note] || "").trim(),
    });
  });
  return { expenses, incomes, invalid };
}

// Add imported rows to the data.
// - Expenses become transactions. Missing months and budget items are created.
//   Expenses that already exist (same date, amount and merchant) are skipped,
//   so importing the same file twice doesn't double everything.
// - Months created by an import are marked importedFrom: source
//   ("EveryDollar", or "CSV" for a bank or another app).
//   Only in those months the plan is built from the data: incomes become
//   planned income, and each item's planned amount grows by what was spent.
//   Months the user budgeted themselves keep their plan untouched.
function applyImport(data, expenses, incomes, makeId, source) {
  const stats = {
    added: 0, duplicates: 0, itemsCreated: 0, monthsCreated: [], months: [],
    incomesAdded: 0, incomesSkipped: 0,
  };

  // Get a month to put imported rows in, creating (and marking) it if needed.
  function monthFor(monthKey) {
    if (!data.months[monthKey]) {
      data.months[monthKey] = { incomes: [], groups: [], importedFrom: source || "EveryDollar" };
      stats.monthsCreated.push(monthKey);
    }
    return data.months[monthKey];
  }
  const key = (t) => t.date + "|" + t.amount + "|" + normName(t.merchant);
  const existing = new Set(data.transactions.map(key));

  // Same item name -> same id in every month (like copied months).
  const idByName = {};
  Object.values(data.months).forEach((m) => m.groups.forEach((g) => g.items.forEach((it) => {
    if (!idByName[normName(it.name)]) idByName[normName(it.name)] = it.id;
  })));

  function findOrCreateItem(month, itemName, groupName) {
    const wanted = normName(itemName);
    let fallback = null;
    for (const g of month.groups) {
      for (const it of g.items) {
        if (normName(it.name) !== wanted) continue;
        if (!groupName || normName(g.name) === normName(groupName)) return it.id;
        fallback = fallback || it.id;
      }
    }
    if (fallback) return fallback;

    // Not found: add it to its group (created if needed)
    const gName = groupName || "Imported";
    let group = month.groups.find((g) => normName(g.name) === normName(gName));
    if (!group) {
      group = { id: makeId(), name: gName, items: [] };
      month.groups.push(group);
    }
    const usedHere = (id) => month.groups.some((g) => g.items.some((it) => it.id === id));
    let id = idByName[wanted];
    if (!id || usedHere(id)) id = makeId();
    idByName[wanted] = idByName[wanted] || id;
    group.items.push({ id, name: itemName, planned: 0 });
    stats.itemsCreated++;
    return id;
  }

  expenses.forEach((e) => {
    if (existing.has(key(e))) { stats.duplicates++; return; }
    const monthKey = e.date.slice(0, 7);
    const month = monthFor(monthKey);
    const itemId = e.itemName ? findOrCreateItem(month, e.itemName, e.groupName) : null;
    data.transactions.push({
      id: makeId(), type: "expense", date: e.date, amount: e.amount,
      merchant: e.merchant, itemId, note: e.note || "",
    });
    // Imported month: plan = what was actually spent
    if (month.importedFrom && itemId) {
      month.groups.forEach((g) => g.items.forEach((it) => {
        if (it.id === itemId) it.planned = (it.planned || 0) + e.amount;
      }));
    }
    stats.added++;
    if (!stats.months.includes(monthKey)) stats.months.push(monthKey);
  });

  incomes.forEach((inc) => {
    const monthKey = inc.date.slice(0, 7);
    // Don't add income to a month the user planned themselves
    if (data.months[monthKey] && !data.months[monthKey].importedFrom) { stats.incomesSkipped++; return; }
    const month = monthFor(monthKey);
    const already = month.incomes.some((i) =>
      i.date === inc.date && i.planned === inc.amount && normName(i.name) === normName(inc.name));
    if (already) { stats.duplicates++; return; }
    month.incomes.push({ id: makeId(), name: inc.name, planned: inc.amount, date: inc.date });
    stats.incomesAdded++;
    if (!stats.months.includes(monthKey)) stats.months.push(monthKey);
  });

  stats.months.sort();
  return stats;
}
