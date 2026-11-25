// ===== Storage =====
// All data lives in the browser's localStorage under one key.
const STORAGE_KEY = "budget-app-data";

// Starting groups for a brand-new budget (EveryDollar-style).
const DEFAULT_GROUPS = [
  { name: "Giving", items: ["Church", "Charity"] },
  { name: "Savings", items: ["Emergency Fund"] },
  { name: "Housing", items: ["Mortgage/Rent", "Utilities"] },
  { name: "Transportation", items: ["Gas", "Maintenance"] },
  { name: "Food", items: ["Groceries", "Restaurants"] },
  { name: "Personal", items: ["Clothing", "Phone", "Fun Money"] },
];

// Make a short random id for incomes, groups, items and transactions.
function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Load saved data, or start fresh if nothing is saved yet.
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.months) {
      saved.transactions = saved.transactions || [];
      return saved;
    }
  } catch (e) {
    console.warn("Could not read saved data", e);
  }
  return { version: 1, months: {}, transactions: [] };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ===== Date helpers =====
// Dates are plain strings: "2026-11-25" for days, "2026-11" for months.
function pad(n) {
  return String(n).padStart(2, "0");
}

// Today's date as "YYYY-MM-DD" in the user's own time zone.
function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function currentMonthKey() {
  return todayString().slice(0, 7);
}

// "2026-11" + 1 -> "2026-12", "2026-01" - 1 -> "2025-12"
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}

function daysInMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// "2026-11" -> "November 2026"
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// "2026-11-25" -> "Nov 25"
function formatDate(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Move a date to the same day in another month, e.g. Nov 15 -> Dec 15.
// Days that don't exist (Jan 31 -> Feb) become the last day of the month.
function sameDayIn(dateString, key) {
  if (!dateString) return "";
  const day = Math.min(Number(dateString.slice(8, 10)), daysInMonth(key));
  return key + "-" + pad(day);
}

// ===== Money helpers =====
// Work in whole cents so 0.1 + 0.2 adds up exactly.
function toCents(value) {
  const n = parseFloat(String(value).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function formatMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  return sign + "$" + (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Show a stored amount in an input (empty when zero, so it's easy to type).
function amountForInput(cents) {
  return cents ? (cents / 100).toFixed(2) : "";
}

// ===== Months =====
// A fresh month with the default groups and one empty paycheck.
function freshMonth() {
  return {
    incomes: [{ id: newId(), name: "Paycheck", planned: 0, date: "" }],
    groups: DEFAULT_GROUPS.map((g) => ({
      id: newId(),
      name: g.name,
      items: g.items.map((name) => ({ id: newId(), name, planned: 0 })),
    })),
  };
}

// Copy another month's plan: incomes (dates moved to the new month),
// groups, items and planned amounts. Spending is not copied.
// Ids stay the same, so "Groceries" is the same item in every month.
function copyMonth(fromKey, toKey) {
  const src = data.months[fromKey];
  return {
    incomes: src.incomes.map((i) => ({
      id: i.id, name: i.name, planned: i.planned, date: sameDayIn(i.date, toKey),
    })),
    groups: src.groups.map((g) => ({
      id: g.id,
      name: g.name,
      items: g.items.map((it) => ({ id: it.id, name: it.name, planned: it.planned })),
    })),
  };
}

// The closest month that already has a budget: earlier months first
// ("copy from last month"), otherwise the nearest later one.
function closestBudgetMonth(key) {
  const keys = Object.keys(data.months).sort();
  const earlier = keys.filter((k) => k < key);
  if (earlier.length) return earlier[earlier.length - 1];
  return keys.find((k) => k > key) || null;
}

// ===== App state =====
const data = loadData();

// The very first time, start the current month with default groups.
if (Object.keys(data.months).length === 0) {
  data.months[currentMonthKey()] = freshMonth();
  saveData();
}

let viewMonth = currentMonthKey();    // the month on screen, "YYYY-MM"
let month = data.months[viewMonth];   // its budget, or undefined if none yet

function goToMonth(key) {
  viewMonth = key;
  month = data.months[key];
  render();
  window.scrollTo(0, 0);
}

// ===== Transactions =====
// Expenses whose date falls in the month on screen.
function monthExpenses() {
  return data.transactions.filter(
    (t) => t.type === "expense" && t.date && t.date.startsWith(viewMonth)
  );
}

// Total spent per budget item id, e.g. { abc123: 4599 }.
function spentByItem() {
  const spent = {};
  monthExpenses().forEach((t) => {
    spent[t.itemId] = (spent[t.itemId] || 0) + t.amount;
  });
  return spent;
}

// Find a budget item (and its group) in the month on screen by id.
function findItem(itemId) {
  if (!month) return null;
  for (const group of month.groups) {
    const item = group.items.find((i) => i.id === itemId);
    if (item) return { item, group };
  }
  return null;
}

// ===== Totals =====
function sumPlanned(list) {
  return list.reduce((total, x) => total + (x.planned || 0), 0);
}

// Update all numbers on the page without re-rendering
// (re-rendering while typing would steal focus from the input).
function updateTotals() {
  const box = document.getElementById("left-to-budget");
  const amountEl = document.getElementById("ltb-amount");
  const labelEl = document.getElementById("ltb-label");

  if (!month) {
    amountEl.textContent = "$0.00";
    labelEl.textContent = "No budget yet";
    box.classList.remove("zero", "over");
    return;
  }

  const spent = spentByItem();
  const incomeTotal = sumPlanned(month.incomes);
  let plannedTotal = 0;

  month.groups.forEach((g) => {
    const groupTotal = sumPlanned(g.items);
    plannedTotal += groupTotal;
    const el = document.querySelector(`[data-group-total="${g.id}"]`);
    if (el) el.textContent = formatMoney(groupTotal);

    // Spent / Remaining line on each item; red when overspent
    g.items.forEach((item) => {
      const row = document.querySelector(`[data-item-row="${item.id}"]`);
      if (!row) return;
      const itemSpent = spent[item.id] || 0;
      const remaining = (item.planned || 0) - itemSpent;
      row.querySelector(".spent").textContent = "Spent " + formatMoney(itemSpent);
      row.querySelector(".remaining").textContent =
        (remaining < 0 ? "Over " + formatMoney(-remaining) : formatMoney(remaining) + " left");
      row.classList.toggle("over", remaining < 0);
    });
  });

  document.getElementById("income-total").textContent = formatMoney(incomeTotal);

  const left = incomeTotal - plannedTotal;
  amountEl.textContent = formatMoney(left);
  box.classList.toggle("zero", left === 0 && incomeTotal > 0);
  box.classList.toggle("over", left < 0);
  labelEl.textContent =
    left === 0 && incomeTotal > 0 ? "Every dollar has a job!"
    : left < 0 ? "Over budget"
    : "Left to budget";
}

// ===== Budget view =====
// Create one editable row. kind = "income" (gets a date line)
// or "item" (gets a "Spent · Remaining" line).
function rowElement(entry, kind, onDelete) {
  const placeholder = kind === "income" ? "Income name" : "Item name";
  const li = document.createElement("li");
  li.className = "row";

  const main = document.createElement("div");
  main.className = "row-main";

  const name = document.createElement("input");
  name.className = "name";
  name.value = entry.name;
  name.placeholder = placeholder;
  name.setAttribute("aria-label", "Name");
  name.addEventListener("input", () => {
    entry.name = name.value;
    saveData();
  });

  const money = document.createElement("label");
  money.className = "money";
  const dollar = document.createElement("span");
  dollar.textContent = "$";
  const amount = document.createElement("input");
  amount.inputMode = "decimal";
  amount.placeholder = "0.00";
  amount.value = amountForInput(entry.planned);
  amount.setAttribute("aria-label", "Planned amount");
  amount.addEventListener("input", () => {
    entry.planned = toCents(amount.value);
    saveData();
    updateTotals();
  });
  // Tidy the number when leaving the field, e.g. "12.5" -> "12.50".
  amount.addEventListener("blur", () => {
    amount.value = amountForInput(entry.planned);
  });
  money.append(dollar, amount);

  const del = document.createElement("button");
  del.className = "del";
  del.textContent = "×";
  del.title = "Delete";
  del.setAttribute("aria-label", "Delete " + (entry.name || placeholder));
  del.addEventListener("click", onDelete);

  main.append(name, money, del);
  li.append(main);

  if (kind === "income") {
    // Optional pay date, limited to the month on screen
    const sub = document.createElement("label");
    sub.className = "row-sub";
    sub.textContent = "Date";
    const date = document.createElement("input");
    date.type = "date";
    date.value = entry.date || "";
    date.min = viewMonth + "-01";
    date.max = viewMonth + "-" + pad(daysInMonth(viewMonth));
    date.setAttribute("aria-label", "Income date");
    date.addEventListener("change", () => {
      entry.date = date.value;
      saveData();
    });
    sub.append(date);
    li.append(sub);
  } else {
    li.dataset.itemRow = entry.id;
    const stats = document.createElement("div");
    stats.className = "row-stats";
    stats.innerHTML = '<span class="spent"></span><span class="remaining"></span>';
    li.append(stats);
  }
  return li;
}

function renderIncomes() {
  const list = document.getElementById("income-list");
  list.innerHTML = "";
  month.incomes.forEach((income) => {
    list.append(
      rowElement(income, "income", () => {
        if (!confirm(`Delete "${income.name || "this income"}"?`)) return;
        month.incomes = month.incomes.filter((x) => x !== income);
        saveData();
        render();
      })
    );
  });
}

function renderGroups() {
  const container = document.getElementById("groups");
  container.innerHTML = "";

  month.groups.forEach((group) => {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.groupId = group.id;

    // Group header: editable name, total, delete button
    const head = document.createElement("div");
    head.className = "card-head";
    const name = document.createElement("input");
    name.className = "group-name";
    name.value = group.name;
    name.placeholder = "Group name";
    name.setAttribute("aria-label", "Group name");
    name.addEventListener("input", () => {
      group.name = name.value;
      saveData();
    });
    const total = document.createElement("span");
    total.className = "card-total";
    total.dataset.groupTotal = group.id;
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Delete group";
    del.setAttribute("aria-label", "Delete group " + group.name);
    del.addEventListener("click", () => {
      if (!confirm(`Delete group "${group.name || "Untitled"}" and all its items?\nExpenses in it will stay, but become uncategorized.`)) return;
      month.groups = month.groups.filter((g) => g !== group);
      saveData();
      render();
    });
    head.append(name, total, del);

    const caption = document.createElement("div");
    caption.className = "col-caption";
    caption.textContent = "Planned";

    // Item rows
    const list = document.createElement("ul");
    list.className = "rows";
    group.items.forEach((item) => {
      list.append(
        rowElement(item, "item", () => {
          if (!confirm(`Delete "${item.name || "this item"}"?\nExpenses in it will stay, but become uncategorized.`)) return;
          group.items = group.items.filter((x) => x !== item);
          saveData();
          render();
        })
      );
    });

    const add = document.createElement("button");
    add.className = "add-btn";
    add.textContent = "+ Add item";
    add.addEventListener("click", () => {
      group.items.push({ id: newId(), name: "", planned: 0 });
      saveData();
      render();
      focusLastName(group.id);
    });

    card.append(head, caption, list, add);
    container.append(card);
  });
}

// After adding a row, put the cursor in its name field.
function focusLastName(groupId) {
  const scope = groupId
    ? document.querySelector(`[data-group-id="${groupId}"]`)
    : document.getElementById("income-list");
  const inputs = scope ? scope.querySelectorAll(".rows .name") : [];
  if (inputs.length) inputs[inputs.length - 1].focus();
}

// The "No budget for this month yet" card with copy / start fresh buttons.
function renderNewMonthCard() {
  const source = closestBudgetMonth(viewMonth);
  document.getElementById("new-month-title").textContent =
    "No budget for " + monthLabel(viewMonth) + " yet";
  const copyBtn = document.getElementById("copy-month");
  copyBtn.hidden = !source;
  copyBtn.dataset.source = source || "";
  if (source) copyBtn.textContent = "Copy plan from " + monthLabel(source);
  document.getElementById("new-month-text").textContent = source
    ? "Copies income, groups and planned amounts. Spending is not copied."
    : "Start with the default groups and fill in your plan.";
}

// ===== Transactions view =====
function renderTransactions() {
  const list = document.getElementById("tx-list");
  list.innerHTML = "";

  // Newest date first
  const expenses = monthExpenses().sort((a, b) => b.date.localeCompare(a.date));
  let total = 0;

  expenses.forEach((t) => {
    total += t.amount;
    const found = findItem(t.itemId);

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "tx";
    btn.addEventListener("click", () => openExpenseSheet(t));

    const info = document.createElement("div");
    info.className = "tx-info";
    const merchant = document.createElement("div");
    merchant.className = "tx-merchant";
    merchant.textContent = t.merchant || (found ? found.item.name : "") || "Expense";
    const meta = document.createElement("div");
    meta.className = "tx-meta" + (found ? "" : " missing");
    meta.textContent = formatDate(t.date) + " · " +
      (found ? (found.item.name || "Untitled") : "Uncategorized");
    info.append(merchant, meta);

    const amount = document.createElement("div");
    amount.className = "tx-amount";
    amount.textContent = formatMoney(t.amount);

    btn.append(info, amount);
    li.append(btn);
    list.append(li);
  });

  document.getElementById("tx-total").textContent = formatMoney(total);
  document.getElementById("tx-empty").hidden = expenses.length > 0;
}

// ===== Add / edit expense sheet =====
const dialog = document.getElementById("tx-dialog");
const form = document.getElementById("tx-form");
const amountInput = document.getElementById("tx-amount");
const merchantInput = document.getElementById("tx-merchant");
const dateInput = document.getElementById("tx-date");
const itemsBox = document.getElementById("tx-items");
const errorBox = document.getElementById("tx-error");
const deleteBtn = document.getElementById("tx-delete");

let editing = null;        // the transaction being edited, or null when adding
let selectedItemId = null; // which budget item chip is selected

// Show every budget item as a tappable chip, grouped like the budget.
function renderItemChips() {
  itemsBox.innerHTML = "";
  month.groups.forEach((group) => {
    if (!group.items.length) return;
    const label = document.createElement("div");
    label.className = "chip-group";
    label.textContent = group.name || "Untitled";
    const chips = document.createElement("div");
    chips.className = "chips";
    group.items.forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (item.id === selectedItemId ? " selected" : "");
      chip.textContent = item.name || "Untitled";
      chip.addEventListener("click", () => {
        selectedItemId = item.id;
        itemsBox.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        errorBox.textContent = "";
      });
      chips.append(chip);
    });
    itemsBox.append(label, chips);
  });
}

// Open the sheet empty (new expense) or filled in (editing one).
function openExpenseSheet(transaction) {
  if (!month) return;
  editing = transaction || null;
  // New expenses default to today, or the 1st if viewing another month
  const defaultDate = currentMonthKey() === viewMonth ? todayString() : viewMonth + "-01";
  document.getElementById("tx-title").textContent = editing ? "Edit expense" : "Add expense";
  amountInput.value = editing ? amountForInput(editing.amount) : "";
  merchantInput.value = editing ? editing.merchant : "";
  dateInput.value = editing ? editing.date : defaultDate;
  selectedItemId = editing && findItem(editing.itemId) ? editing.itemId : null;
  deleteBtn.hidden = !editing;
  errorBox.textContent = "";
  renderItemChips();
  dialog.showModal();
  amountInput.focus();
}

function closeExpenseSheet() {
  dialog.close();
  editing = null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = toCents(amountInput.value);
  if (amount <= 0) {
    errorBox.textContent = "Enter an amount.";
    amountInput.focus();
    return;
  }
  if (!selectedItemId) {
    errorBox.textContent = "Pick a budget item.";
    return;
  }
  if (!dateInput.value) {
    errorBox.textContent = "Pick a date.";
    return;
  }

  const fields = {
    amount,
    date: dateInput.value,
    merchant: merchantInput.value.trim(),
    itemId: selectedItemId,
  };
  if (editing) {
    Object.assign(editing, fields);
  } else {
    data.transactions.push({ id: newId(), type: "expense", note: "", ...fields });
  }
  saveData();
  closeExpenseSheet();
  render();
});

deleteBtn.addEventListener("click", () => {
  if (!editing || !confirm("Delete this expense?")) return;
  data.transactions = data.transactions.filter((t) => t !== editing);
  saveData();
  closeExpenseSheet();
  render();
});

document.getElementById("tx-cancel").addEventListener("click", closeExpenseSheet);

// Tapping the dark area outside the sheet closes it.
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) closeExpenseSheet();
});

document.getElementById("fab").addEventListener("click", () => openExpenseSheet(null));

// ===== Tabs =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.getElementById("view-budget").hidden = view !== "budget";
    document.getElementById("view-transactions").hidden = view !== "transactions";
    window.scrollTo(0, 0);
  });
});

// ===== Month navigation =====
document.getElementById("prev-month").addEventListener("click", () => goToMonth(addMonths(viewMonth, -1)));
document.getElementById("next-month").addEventListener("click", () => goToMonth(addMonths(viewMonth, 1)));
document.getElementById("today-btn").addEventListener("click", () => goToMonth(currentMonthKey()));

document.getElementById("copy-month").addEventListener("click", (e) => {
  data.months[viewMonth] = copyMonth(e.currentTarget.dataset.source, viewMonth);
  saveData();
  goToMonth(viewMonth);
});

document.getElementById("fresh-month").addEventListener("click", () => {
  data.months[viewMonth] = freshMonth();
  saveData();
  goToMonth(viewMonth);
});

// ===== Draw everything =====
function render() {
  document.getElementById("month-title").textContent = monthLabel(viewMonth);
  document.getElementById("today-btn").hidden = viewMonth === currentMonthKey();

  // A month without a budget only shows the "copy / start fresh" card.
  document.getElementById("new-month").hidden = !!month;
  document.getElementById("budget-content").hidden = !month;
  document.getElementById("fab").hidden = !month;

  if (month) {
    renderIncomes();
    renderGroups();
  } else {
    renderNewMonthCard();
  }
  renderTransactions();
  updateTotals();
}

// ===== Buttons that never get re-rendered =====
document.getElementById("add-income").addEventListener("click", () => {
  month.incomes.push({ id: newId(), name: "", planned: 0, date: "" });
  saveData();
  render();
  focusLastName(null);
});

document.getElementById("add-group").addEventListener("click", () => {
  const group = { id: newId(), name: "", items: [{ id: newId(), name: "", planned: 0 }] };
  month.groups.push(group);
  saveData();
  render();
  const input = document.querySelector(`[data-group-id="${group.id}"] .group-name`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

render();
