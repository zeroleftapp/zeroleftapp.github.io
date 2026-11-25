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

// Make a short random id for incomes, groups and items.
function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// The current month as "YYYY-MM", e.g. "2026-11".
function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Build an empty month with the default groups.
function newMonth() {
  return {
    incomes: [{ id: newId(), name: "Paycheck", planned: 0 }],
    groups: DEFAULT_GROUPS.map((g) => ({
      id: newId(),
      name: g.name,
      items: g.items.map((name) => ({ id: newId(), name, planned: 0 })),
    })),
  };
}

// Load saved data, or start fresh if nothing is saved yet.
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.months) return saved;
  } catch (e) {
    console.warn("Could not read saved data", e);
  }
  return { version: 1, months: {}, transactions: [] };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const data = loadData();
const monthKey = currentMonthKey();
if (!data.months[monthKey]) {
  data.months[monthKey] = newMonth();
  saveData();
}
const month = data.months[monthKey];

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
function amountForInput(planned) {
  return planned ? (planned / 100).toFixed(2) : "";
}

// ===== Totals =====
function sum(list) {
  return list.reduce((total, x) => total + (x.planned || 0), 0);
}

// Update the numbers at the top and on each card without re-rendering
// (re-rendering while typing would steal focus from the input).
function updateTotals() {
  const incomeTotal = sum(month.incomes);
  let plannedTotal = 0;
  month.groups.forEach((g) => {
    const groupTotal = sum(g.items);
    plannedTotal += groupTotal;
    const el = document.querySelector(`[data-group-total="${g.id}"]`);
    if (el) el.textContent = formatMoney(groupTotal);
  });

  document.getElementById("income-total").textContent = formatMoney(incomeTotal);

  const left = incomeTotal - plannedTotal;
  const box = document.getElementById("left-to-budget");
  document.getElementById("ltb-amount").textContent = formatMoney(left);
  box.classList.toggle("zero", left === 0 && incomeTotal > 0);
  box.classList.toggle("over", left < 0);
  document.getElementById("ltb-label").textContent =
    left === 0 && incomeTotal > 0 ? "Every dollar has a job!"
    : left < 0 ? "over budget"
    : "left to budget";
}

// ===== Rendering =====
// Create one editable row (used for both incomes and budget items).
function rowElement(entry, placeholder, onDelete) {
  const li = document.createElement("li");
  li.className = "row";

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

  li.append(name, money, del);
  return li;
}

function renderIncomes() {
  const list = document.getElementById("income-list");
  list.innerHTML = "";
  month.incomes.forEach((income) => {
    list.append(
      rowElement(income, "Income name", () => {
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
      if (!confirm(`Delete group "${group.name || "Untitled"}" and all its items?`)) return;
      month.groups = month.groups.filter((g) => g !== group);
      saveData();
      render();
    });
    head.append(name, total, del);

    // Item rows
    const list = document.createElement("ul");
    list.className = "rows";
    group.items.forEach((item) => {
      list.append(
        rowElement(item, "Item name", () => {
          if (!confirm(`Delete "${item.name || "this item"}"?`)) return;
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
      focusLastName(card.dataset.groupId);
    });

    card.dataset.groupId = group.id;
    card.append(head, list, add);
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

function render() {
  const [y, m] = monthKey.split("-");
  document.getElementById("month-title").textContent = new Date(y, m - 1)
    .toLocaleString("en-US", { month: "long", year: "numeric" });
  renderIncomes();
  renderGroups();
  updateTotals();
}

// ===== Buttons that never get re-rendered =====
document.getElementById("add-income").addEventListener("click", () => {
  month.incomes.push({ id: newId(), name: "", planned: 0 });
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
