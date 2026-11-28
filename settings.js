// ===== Settings view: backup, CSV export, CSV import =====
// Uses data, saveData, refreshAfterDataChange etc. from app.js.

// Let the browser download a file made in the page.
function downloadFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----- (1) Full backup as JSON, and restore -----
// Backup dates are kept in their own keys, so restoring a backup
// doesn't change when the last backup was made.
const LAST_BACKUP_KEY = "budget-app-last-backup";
const FIRST_USE_KEY = "budget-app-first-use";
const SNOOZE_KEY = "budget-app-backup-snoozed";

function downloadBackup() {
  downloadFile("zero-left-backup-" + todayString() + ".json",
    JSON.stringify(data, null, 2), "application/json");
  localStorage.setItem(LAST_BACKUP_KEY, todayString());
  updateBackupInfo();
}

document.getElementById("export-json").addEventListener("click", downloadBackup);

const restoreFile = document.getElementById("restore-file");
document.getElementById("restore-json").addEventListener("click", () => restoreFile.click());

restoreFile.addEventListener("change", async () => {
  const file = restoreFile.files[0];
  restoreFile.value = ""; // so the same file can be picked again
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || typeof backup.months !== "object" || Array.isArray(backup.months)) {
      throw new Error("This doesn't look like a budget backup file.");
    }
    if (!confirm("Replace ALL current data with this backup?\nTip: download a backup of your current data first.")) return;
    Object.keys(data).forEach((k) => delete data[k]);
    Object.assign(data, backup);
    data.transactions = Array.isArray(data.transactions) ? data.transactions : [];
    data.bills = Array.isArray(data.bills) ? data.bills : [];
    saveData();
    refreshAfterDataChange();
    alert("Backup restored.");
  } catch (e) {
    alert("Could not restore: " + e.message);
  }
});

// ----- (2) Transactions as CSV -----
document.getElementById("export-csv").addEventListener("click", () => {
  const rows = [["Date", "Merchant", "Amount", "Group", "Item", "Type", "Note"]];
  const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
  sorted.forEach((t) => {
    // Find the item's name in the month of the transaction
    const m = data.months[t.date.slice(0, 7)];
    let groupName = "", itemName = "";
    if (m) {
      m.groups.forEach((g) => g.items.forEach((it) => {
        if (it.id === t.itemId) { groupName = g.name; itemName = it.name; }
      }));
    }
    rows.push([t.date, t.merchant, (t.amount / 100).toFixed(2), groupName, itemName, t.type, t.note]);
  });
  downloadFile("zero-left-transactions-" + todayString() + ".csv", toCSV(rows), "text/csv");
});

// ----- (3) Import: EveryDollar, or a bank / another app -----
// Two ways in, same steps after:
// - "EveryDollar": its known columns (Group, Item, Type...) are recognized,
//   and budget summary files are skipped with an explanation.
// - "CSV" (bank or another app): only basic guesses; the user picks the
//   columns, helped by a plain-language example of the first rows.
const importFile = document.getElementById("import-file");
const importStep = document.getElementById("import-step");
const importResult = document.getElementById("import-result");
const mapSelects = {
  date: document.getElementById("map-date"),
  amount: document.getElementById("map-amount"),
  moneyOut: document.getElementById("map-moneyOut"),
  moneyIn: document.getElementById("map-moneyIn"),
  merchant: document.getElementById("map-merchant"),
  item: document.getElementById("map-item"),
  group: document.getElementById("map-group"),
  type: document.getElementById("map-type"),
  note: document.getElementById("map-note"),
};
const signSelect = document.getElementById("map-sign");
const amountMode = document.getElementById("map-amount-mode");

// What each chosen column is used for (shown above the preview table)
const FIELD_NAMES = {
  date: "Date", amount: "Amount", moneyOut: "Money out", moneyIn: "Money in",
  merchant: "Merchant", item: "Budget item", group: "Budget group",
  type: "Income or expense", note: "Note",
};

let importSource = "EveryDollar"; // or "CSV"
let importRecords = []; // every row from every file, as { header: value }
let importHeaders = []; // all column names seen in the files
let leftOut = new Set(); // rows the user unchecked (record objects)
let showAllRows = false; // "Show all" pressed in the row list
const SAMPLE_ROWS = 5;

// "1 expense", "2 expenses"
function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

// Open the file picker for one kind of import (also used by the welcome screen).
function chooseImportFiles(source) {
  importSource = source;
  importFile.click();
}
document.getElementById("import-choose").addEventListener("click", () => chooseImportFiles("EveryDollar"));
document.getElementById("import-choose-other").addEventListener("click", () => chooseImportFiles("CSV"));

// Read the chosen files and show the column choice step.
importFile.addEventListener("change", async () => {
  const files = [...importFile.files];
  importFile.value = "";
  if (!files.length) return;
  const everyDollar = importSource === "EveryDollar";

  // Coming from the welcome screen: continue in Settings, where the import lives
  setWelcome(false);
  showView("settings");
  importGo.hidden = true;

  importRecords = [];
  importHeaders = [];
  leftOut = new Set();
  showAllRows = false;
  const names = [];
  const summaryFiles = []; // EveryDollar budget summaries (no transactions)
  for (const file of files) {
    const table = tableFromRows(parseCSV(await file.text()));
    if (!table.records.length) continue; // no data rows
    if (everyDollar && isBudgetSummaryFile(table.headers)) { summaryFiles.push(file.name); continue; }
    table.headers.forEach((h) => { if (!importHeaders.includes(h)) importHeaders.push(h); });
    importRecords.push(...table.records);
    names.push(file.name);
  }

  const summaryNote = summaryFiles.length
    ? " Skipped " + summaryFiles.length + " budget summary file" + (summaryFiles.length > 1 ? "s" : "") +
      " (Planned / Spent / Remaining, no transactions): " + summaryFiles.join(", ") + "."
    : "";

  if (!importRecords.length) {
    showImportResult(summaryFiles.length
      ? "These look like EveryDollar budget summaries (Planned / Spent / Remaining), not transactions. Download the month again and pick the other option in EveryDollar's \"Download as CSV\" (most likely \"This month's budget\")." + summaryNote
      : "No rows found in the chosen file(s).", true);
    importStep.hidden = true;
    return;
  }

  // Fill the column dropdowns and pre-select good guesses
  const guess = everyDollar
    ? Object.assign({ moneyOut: "", moneyIn: "" }, guessColumns(importHeaders))
    : guessBankColumns(importHeaders, importRecords);
  Object.entries(mapSelects).forEach(([field, select]) => {
    select.innerHTML = "";
    select.append(new Option("— none —", ""));
    importHeaders.forEach((h) => select.append(new Option(h, h)));
    select.value = guess[field];
  });
  amountMode.value = !guess.amount && (guess.moneyOut || guess.moneyIn) ? "two" : "one";
  signSelect.value = looksNegative(importRecords, guess) ? "negative" : "positive";

  document.getElementById("import-hint").textContent = everyDollar
    ? "We recognized your EveryDollar columns. Check your rows below, and change a column if something looks wrong."
    : "Tell us which column in your file is which. We've filled in our best guesses: check them against your rows below.";
  document.querySelector(".sample-hint").textContent = everyDollar
    ? "Uncheck any row you don't want to import."
    : "Uncheck any row you don't want to import. Credit card payments aren't income or spending – uncheck them.";
  setMoreOptions(false);
  document.getElementById("import-files").textContent =
    plural(importRecords.length, "row") + " from " + plural(names.length, "file") +
    ": " + names.join(", ") + "." + summaryNote;
  importResult.hidden = true;
  importStep.hidden = false;
  updateImportPreview();
  importStep.scrollIntoView({ behavior: "smooth", block: "start" });
});

// The chosen columns. Only the amount column(s) of the chosen mode count.
function currentMap() {
  const map = {};
  Object.entries(mapSelects).forEach(([field, select]) => { map[field] = select.value; });
  if (amountMode.value === "two") map.amount = "";
  else { map.moneyOut = ""; map.moneyIn = ""; }
  return map;
}

// One row in plain words, e.g. "Nov 2 · KROGER #412 · spent $87.45 · Groceries"
function describeRow(record, map) {
  const read = readImportRows([record], map, signSelect.value === "negative");
  const e = read.expenses[0], inc = read.incomes[0];
  if (e) {
    return [formatDate(e.date), e.merchant || "(no merchant)",
      (e.amount < 0 ? "refund " : "spent ") + formatMoney(Math.abs(e.amount)),
      e.itemName || "Uncategorized"].join(" · ");
  }
  if (inc) return [formatDate(inc.date), inc.name, "money in " + formatMoney(inc.amount)].join(" · ");
  return "Skipped: no valid date or amount";
}

// Example rows, preview table (with what each column is used for) and summary.
function updateImportPreview() {
  const map = currentMap();
  const two = amountMode.value === "two";
  document.getElementById("map-amount-label").hidden = two;
  document.getElementById("map-out-label").hidden = !two;
  document.getElementById("map-in-label").hidden = !two;
  // With two columns the sign is already clear
  document.getElementById("map-sign-label").hidden = two;

  const usedFor = {};
  Object.entries(map).forEach(([field, h]) => { if (h) usedFor[h] = FIELD_NAMES[field]; });

  const table = document.getElementById("import-table");
  table.innerHTML = "";
  const head = table.insertRow();
  importHeaders.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (usedFor[h]) {
      th.className = "mapped";
      const tag = document.createElement("span");
      tag.className = "used-for";
      tag.textContent = "→ " + usedFor[h];
      th.append(tag);
    }
    head.append(th);
  });
  importRecords.slice(0, 5).forEach((r) => {
    const tr = table.insertRow();
    importHeaders.forEach((h) => { tr.insertCell().textContent = r[h]; });
  });

  const summary = document.getElementById("import-summary");
  const runBtn = document.getElementById("import-run");
  const sample = document.getElementById("import-sample");
  sample.innerHTML = "";
  const hasAmount = two ? map.moneyOut || map.moneyIn : map.amount;
  if (!map.date || !hasAmount) {
    summary.textContent = two
      ? "Choose the Date column, and at least one of Money out / Money in."
      : "Choose the Date and Amount columns.";
    runBtn.disabled = true;
    runBtn.textContent = "Import";
    return;
  }

  // Each row in plain words, with a checkbox to leave it out
  const shown = showAllRows ? importRecords : importRecords.slice(0, SAMPLE_ROWS);
  shown.forEach((r) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    const text = describeRow(r, map);
    const unreadable = text.startsWith("Skipped");
    box.checked = !unreadable && !leftOut.has(r);
    box.disabled = unreadable;
    box.addEventListener("change", () => {
      if (box.checked) leftOut.delete(r); else leftOut.add(r);
      updateImportPreview();
    });
    const span = document.createElement("span");
    span.textContent = text;
    label.append(box, span);
    li.append(label);
    li.classList.toggle("left-out", !box.checked);
    sample.append(li);
  });
  const allBtn = document.getElementById("sample-all");
  allBtn.hidden = importRecords.length <= SAMPLE_ROWS;
  allBtn.textContent = showAllRows ? "Show fewer" : "Show all " + importRecords.length + " rows";

  const result = readImportRows(rowsToImport(), map, signSelect.value === "negative");
  let text = plural(result.expenses.length, "expense");
  if (result.incomes.length) text += " and " + plural(result.incomes.length, "money-in row") + " (paychecks, deposits)";
  text += " ready to import.";
  if (leftOut.size) text += " " + plural(leftOut.size, "row") + " left out by you.";
  if (result.invalid) text += " " + plural(result.invalid, "row") + " without a valid date or amount will be skipped.";
  if (!map.item) text += " No budget item column chosen: expenses come in as Uncategorized, and you can pick an item for each one later in Transactions.";
  summary.textContent = text;
  const count = result.expenses.length + result.incomes.length;
  runBtn.disabled = count === 0;
  runBtn.textContent = "Import " + plural(count, "row");
  updateMoreLabel(map);
}

// The rows that will be imported: all except the unchecked ones
function rowsToImport() {
  return importRecords.filter((r) => !leftOut.has(r));
}

document.getElementById("sample-all").addEventListener("click", () => {
  showAllRows = !showAllRows;
  updateImportPreview();
});

// "More options": budget item, group, type and note columns
const moreBtn = document.getElementById("map-more-btn");
function setMoreOptions(open) {
  document.getElementById("map-more").hidden = !open;
  moreBtn.setAttribute("aria-expanded", String(open));
}
function updateMoreLabel(map) {
  const open = moreBtn.getAttribute("aria-expanded") === "true";
  const chosen = ["item", "group", "type", "note"].filter((f) => map[f]).length;
  moreBtn.textContent = open ? "Fewer options" : "More options" + (chosen ? " (" + chosen + " chosen)" : "");
}
moreBtn.addEventListener("click", () => {
  setMoreOptions(moreBtn.getAttribute("aria-expanded") !== "true");
  updateMoreLabel(currentMap());
});

Object.values(mapSelects).forEach((s) => s.addEventListener("change", updateImportPreview));
signSelect.addEventListener("change", updateImportPreview);
amountMode.addEventListener("change", updateImportPreview);
// When the amount, type or group column changes, guess the sign again
[mapSelects.amount, mapSelects.type, mapSelects.group].forEach((s) => s.addEventListener("change", () => {
  signSelect.value = looksNegative(importRecords, currentMap()) ? "negative" : "positive";
  updateImportPreview();
}));

document.getElementById("import-cancel").addEventListener("click", () => {
  importStep.hidden = true;
  importRecords = [];
});

document.getElementById("import-run").addEventListener("click", () => {
  const { expenses, incomes, invalid } =
    readImportRows(rowsToImport(), currentMap(), signSelect.value === "negative");
  const stats = applyImport(data, expenses, incomes, newId, importSource);
  // New months without any budget items (e.g. a bank file without
  // categories) get the usual starter groups, ready to fill in.
  stats.monthsCreated.forEach((key) => {
    if (!data.months[key].groups.length) data.months[key].groups = freshMonth().groups;
    addBillsToMonth(key);
  });
  saveData();
  refreshAfterDataChange();
  importStep.hidden = true;
  importRecords = [];

  // Tell the user exactly what happened
  const parts = [];
  if (stats.added || stats.incomesAdded) {
    const first = monthLabel(stats.months[0]);
    const last = monthLabel(stats.months[stats.months.length - 1]);
    let text = "Imported " + plural(stats.added, "expense");
    if (stats.incomesAdded) text += " and " + plural(stats.incomesAdded, "income");
    parts.push(text + " (" + (first === last ? first : first + " – " + last) + ").");
  } else {
    parts.push("Nothing new to import.");
  }
  if (stats.monthsCreated.length) {
    parts.push("Created " + plural(stats.monthsCreated.length, "new month") +
      ", with a plan built from the imported data.");
  }
  if (stats.itemsCreated) parts.push("Added " + plural(stats.itemsCreated, "budget item") + ".");
  if (stats.incomesSkipped) {
    parts.push(plural(stats.incomesSkipped, "income row") +
      " fell in months you had already budgeted, so your plan there was left as it is.");
  }
  const skipped = [];
  if (stats.duplicates) skipped.push(stats.duplicates + " already imported");
  if (invalid) skipped.push(invalid + " unreadable");
  if (skipped.length) parts.push("Skipped: " + skipped.join(", ") + ".");
  showImportResult(parts.join(" "), false);
  importGo.hidden = !(stats.added || stats.incomesAdded);
});

// "See my budget" after an import: go to this month. If it has no budget
// yet, the Budget view offers to copy the plan from the imported months.
const importGo = document.getElementById("import-go");
importGo.addEventListener("click", () => {
  importGo.hidden = true;
  showView("budget");
  goToMonth(currentMonthKey());
});

function showImportResult(text, isError) {
  importResult.textContent = text;
  importResult.classList.toggle("error", isError);
  importResult.hidden = false;
}

// ----- Keeping data safe -----
// Data lives in this browser only. Two safeguards:
// 1. Ask the browser to keep our storage (not clear it to free up space).
// 2. Remind the user to download a backup once a month.
// 3. Tell iPhone users (once) to add the app to the Home Screen.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

if (!localStorage.getItem(FIRST_USE_KEY)) localStorage.setItem(FIRST_USE_KEY, todayString());

const BACKUP_REMINDER_DAYS = 30;

function daysSince(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const [ty, tm, td] = todayString().split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000);
}

// Show "Last backup" in Settings, and the reminder banner when it's due.
function updateBackupInfo() {
  const last = localStorage.getItem(LAST_BACKUP_KEY);
  document.getElementById("last-backup").textContent =
    "Last backup: " + (last ? formatDate(last) + ", " + last.slice(0, 4) : "never");

  // Count from the newest of: last backup, "Later" tap, first use.
  const dates = [last, localStorage.getItem(SNOOZE_KEY), localStorage.getItem(FIRST_USE_KEY)]
    .filter(Boolean).sort();
  const reference = dates[dates.length - 1];
  const hasData = data.transactions.length > 0;
  document.getElementById("backup-banner").hidden =
    !hasData || !reference || daysSince(reference) < BACKUP_REMINDER_DAYS;
}

document.getElementById("backup-now").addEventListener("click", downloadBackup);
document.getElementById("backup-later").addEventListener("click", () => {
  localStorage.setItem(SNOOZE_KEY, todayString());
  updateBackupInfo();
});

updateBackupInfo();

// ----- iPhone: "Add to Home Screen" tip (shown until dismissed) -----
// On iPhone/iPad, Safari may delete a website's data if it isn't opened
// for 7 days. Apps added to the Home Screen are not affected.
// Note: the Home Screen app keeps its OWN data, separate from Safari,
// so it's best to do this before starting to budget.
const IOS_TIP_KEY = "budget-app-ios-tip-dismissed";

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
}

function isInstalled() {
  return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
}

function updateIOSTip() {
  const show = isIOS() && !isInstalled() && !localStorage.getItem(IOS_TIP_KEY);
  document.getElementById("ios-tip").hidden = !show;
  // Already has data? Then they need a backup to move it to the Home Screen app.
  document.getElementById("ios-tip-move").hidden = data.transactions.length === 0;
}

document.getElementById("ios-tip-ok").addEventListener("click", () => {
  localStorage.setItem(IOS_TIP_KEY, todayString());
  updateIOSTip();
});
document.getElementById("ios-tip-backup").addEventListener("click", downloadBackup);

updateIOSTip();
