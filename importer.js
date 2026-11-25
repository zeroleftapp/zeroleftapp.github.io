// ===== EveryDollar import logic =====
// Pure functions (no page access): they take data in and give results back.
// Uses parseDate and parseAmount from csv.js.

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

// Guess which column is which from the header names.
// Returns header names (or "" when no good guess).
function guessColumns(headers) {
  const find = (test) => headers.find((h) => test(h.toLowerCase())) || "";
  return {
    date: find((h) => h.includes("date")),
    amount: find((h) => h.includes("amount") || h === "amt"),
    merchant: find((h) => /merchant|payee|description|^name$/.test(h)),
    item: find((h) => /item|category|budget/.test(h) && !h.includes("group")),
    group: find((h) => h.includes("group")),
  };
}

// Are most amounts negative? Then expenses are probably the negative ones.
function looksNegative(records, amountColumn) {
  let neg = 0, pos = 0;
  records.forEach((r) => {
    const a = parseAmount(r[amountColumn] || "");
    if (a < 0) neg++;
    else if (a > 0) pos++;
  });
  return neg > pos;
}

// Turn file rows into clean expenses and incomes using the chosen columns.
// map = { date, amount, merchant, item, group } (header names).
function readImportRows(records, map, expensesNegative) {
  const expenses = [];
  const incomes = [];
  let invalid = 0;
  records.forEach((r) => {
    const date = parseDate(r[map.date] || "");
    const amount = parseAmount(r[map.amount] || "");
    if (!date || amount === null || amount === 0) { invalid++; return; }
    const isExpense = expensesNegative ? amount < 0 : amount > 0;
    if (!isExpense) {
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
      amount: Math.abs(amount),
      merchant: String(r[map.merchant] || "").trim(),
      itemName: String(r[map.item] || "").trim(),
      groupName: String(r[map.group] || "").trim(),
    });
  });
  return { expenses, incomes, invalid };
}

// Add imported rows to the data.
// - Expenses become transactions. Missing months and budget items are created.
//   Expenses that already exist (same date, amount and merchant) are skipped,
//   so importing the same file twice doesn't double everything.
// - Months created by an import are marked importedFrom: "EveryDollar".
//   Only in those months the plan is built from the data: incomes become
//   planned income, and each item's planned amount grows by what was spent.
//   Months the user budgeted themselves keep their plan untouched.
function applyImport(data, expenses, incomes, makeId) {
  const stats = {
    added: 0, duplicates: 0, itemsCreated: 0, monthsCreated: [], months: [],
    incomesAdded: 0, incomesSkipped: 0,
  };

  // Get a month to put imported rows in, creating (and marking) it if needed.
  function monthFor(monthKey) {
    if (!data.months[monthKey]) {
      data.months[monthKey] = { incomes: [], groups: [], importedFrom: "EveryDollar" };
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
      merchant: e.merchant, itemId, note: "",
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
