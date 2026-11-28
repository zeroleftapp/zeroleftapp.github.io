// ===== Recurring bills =====
// Pure functions (no page access), so they can be tested.
//
// A bill: { id, itemId, name, amount, due, every, group }
//   due   = the first due date, "YYYY-MM-DD"
//   every = 1 (every month), 3 (every 3 months) or 12 (every year)
//   itemId = the budget item the bill fills in (same id in every month)
//   group = name of the budget group the item goes in
// A bill is paid in a month when there's an expense with its billId
// dated in that month.

const BILL_REPEATS = { 1: "Every month", 3: "Every 3 months", 12: "Every year" };

// "2026-11" -> "2027-02" = 3
function monthsBetween(fromKey, toKey) {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// The bill's due date in a month ("2026-11-15"), or null if not due then.
// A due day that doesn't exist (31st in February) becomes the last day.
function billDueDate(bill, monthKey) {
  const diff = monthsBetween(bill.due.slice(0, 7), monthKey);
  if (diff < 0 || diff % bill.every !== 0) return null;
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(Number(bill.due.slice(8, 10)), lastDay);
  return monthKey + "-" + String(day).padStart(2, "0");
}

function billIsPaid(bill, monthKey, transactions) {
  return transactions.some((t) => t.billId === bill.id && t.date && t.date.startsWith(monthKey));
}

// Put bills into one month's plan: in a month where a bill is due, its
// budget item gets the bill's amount (the item and group are created if
// missing). In other months the item's planned amount is 0.
function applyBillsToMonth(month, monthKey, bills, makeId) {
  bills.forEach((bill) => {
    const due = billDueDate(bill, monthKey);
    let item = null;
    month.groups.forEach((g) => g.items.forEach((it) => { if (it.id === bill.itemId) item = it; }));
    if (!item) {
      if (!due) return;
      const wanted = String(bill.group || "Bills").trim().toLowerCase();
      let group = month.groups.find((g) => g.name.trim().toLowerCase() === wanted);
      if (!group) {
        group = { id: makeId(), name: bill.group || "Bills", items: [] };
        month.groups.push(group);
      }
      item = { id: bill.itemId, name: bill.name, planned: 0 };
      group.items.push(item);
    }
    item.name = bill.name;
    item.planned = due ? bill.amount : 0;
  });
}

// The next paycheck after today: the earliest income date later than
// today. Income dates come from the months' plans; each is also tried a
// month later, since next month's budget may not exist yet (paid on the
// 15th in November -> probably the 15th in December too).
// null when no income has a date.
function nextPayday(months, today) {
  let next = null;
  Object.values(months).forEach((m) => m.incomes.forEach((inc) => {
    if (!inc.date) return;
    const later = billDueDate({ due: inc.date, every: 1 }, nextMonthKey(inc.date.slice(0, 7)));
    [inc.date, later].forEach((d) => {
      if (d > today && (!next || d < next)) next = d;
    });
  }));
  return next;
}

// Unpaid bills due from the start of this month up to (not including)
// `until`. Each: { bill, date, overdue }. Sorted by date.
function upcomingBills(bills, transactions, today, until) {
  const list = [];
  const firstMonth = today.slice(0, 7);
  const lastMonth = until.slice(0, 7);
  for (let key = firstMonth; key <= lastMonth; key = nextMonthKey(key)) {
    bills.forEach((bill) => {
      const date = billDueDate(bill, key);
      if (!date || date >= until || billIsPaid(bill, key, transactions)) return;
      list.push({ bill, date, overdue: date < today });
    });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

function nextMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? (y + 1) + "-01" : y + "-" + String(m + 1).padStart(2, "0");
}
