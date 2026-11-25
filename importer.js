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

// Turn file rows into clean expenses using the chosen columns.
// map = { date, amount, merchant, item, group } (header names).
function readImportRows(records, map, expensesNegative) {
  const expenses = [];
  let invalid = 0, income = 0;
  records.forEach((r) => {
    const date = parseDate(r[map.date] || "");
    const amount = parseAmount(r[map.amount] || "");
    if (!date || amount === null || amount === 0) { invalid++; return; }
    const isExpense = expensesNegative ? amount < 0 : amount > 0;
    if (!isExpense) { income++; return; }
    expenses.push({
      date,
      amount: Math.abs(amount),
      merchant: String(r[map.merchant] || "").trim(),
      itemName: String(r[map.item] || "").trim(),
      groupName: String(r[map.group] || "").trim(),
    });
  });
  return { expenses, invalid, income };
}

// Add expenses to the data. Creates missing months and budget items,
// and skips expenses that already exist (same date, amount and merchant)
// so importing the same file twice doesn't double everything.
function applyImport(data, expenses, makeId) {
  const stats = { added: 0, duplicates: 0, itemsCreated: 0, monthsCreated: [], months: [] };
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
    if (!data.months[monthKey]) {
      data.months[monthKey] = { incomes: [], groups: [] };
      stats.monthsCreated.push(monthKey);
    }
    const itemId = e.itemName ? findOrCreateItem(data.months[monthKey], e.itemName, e.groupName) : null;
    data.transactions.push({
      id: makeId(), type: "expense", date: e.date, amount: e.amount,
      merchant: e.merchant, itemId, note: "",
    });
    stats.added++;
    if (!stats.months.includes(monthKey)) stats.months.push(monthKey);
  });

  stats.months.sort();
  return stats;
}
