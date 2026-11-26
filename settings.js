// ===== Settings view: backup, CSV export, EveryDollar import =====
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

// ----- (3) EveryDollar import -----
const importFile = document.getElementById("import-file");
const importStep = document.getElementById("import-step");
const importResult = document.getElementById("import-result");
const mapSelects = {
  date: document.getElementById("map-date"),
  amount: document.getElementById("map-amount"),
  merchant: document.getElementById("map-merchant"),
  item: document.getElementById("map-item"),
  group: document.getElementById("map-group"),
  type: document.getElementById("map-type"),
  note: document.getElementById("map-note"),
};
const signSelect = document.getElementById("map-sign");

let importRecords = []; // every row from every file, as { header: value }
let importHeaders = []; // all column names seen in the files

document.getElementById("import-choose").addEventListener("click", () => importFile.click());

// Read the chosen files and show the column mapping step.
importFile.addEventListener("change", async () => {
  const files = [...importFile.files];
  importFile.value = "";
  if (!files.length) return;

  // Coming from the welcome screen: continue in Settings, where the import lives
  setWelcome(false);
  showView("settings");
  importGo.hidden = true;

  importRecords = [];
  importHeaders = [];
  const names = [];
  const summaryFiles = []; // EveryDollar budget summaries (no transactions)
  for (const file of files) {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) continue; // no data rows
    const headers = rows[0].map((h) => h.trim());
    if (isBudgetSummaryFile(headers)) { summaryFiles.push(file.name); continue; }
    headers.forEach((h) => { if (h && !importHeaders.includes(h)) importHeaders.push(h); });
    rows.slice(1).forEach((cells) => {
      const record = {};
      headers.forEach((h, i) => { record[h] = cells[i] || ""; });
      importRecords.push(record);
    });
    names.push(file.name);
  }

  const summaryNote = summaryFiles.length
    ? " Skipped " + summaryFiles.length + " budget summary file" + (summaryFiles.length > 1 ? "s" : "") +
      " (Planned / Spent / Remaining, no transactions): " + summaryFiles.join(", ") + "."
    : "";

  if (!importRecords.length) {
    showImportResult(summaryFiles.length
      ? "These look like EveryDollar budget summaries (Planned / Spent / Remaining), not transactions. In EveryDollar's \"Download as CSV\", pick the option that includes your transactions." + summaryNote
      : "No rows found in the chosen file(s).", true);
    importStep.hidden = true;
    return;
  }

  // Fill the column dropdowns and pre-select good guesses
  const guess = guessColumns(importHeaders);
  Object.entries(mapSelects).forEach(([field, select]) => {
    select.innerHTML = "";
    select.append(new Option("— none —", ""));
    importHeaders.forEach((h) => select.append(new Option(h, h)));
    select.value = guess[field];
  });
  signSelect.value = looksNegative(importRecords, guess) ? "negative" : "positive";

  document.getElementById("import-files").textContent =
    importRecords.length + " rows from " + names.length + " file" + (names.length > 1 ? "s" : "") +
    ": " + names.join(", ") + "." + summaryNote;
  importResult.hidden = true;
  importStep.hidden = false;
  updateImportPreview();
  importStep.scrollIntoView({ behavior: "smooth", block: "start" });
});

function currentMap() {
  const map = {};
  Object.entries(mapSelects).forEach(([field, select]) => { map[field] = select.value; });
  return map;
}

// Preview table (first rows, chosen columns highlighted) and a live summary.
function updateImportPreview() {
  const map = currentMap();
  const mapped = Object.values(map).filter(Boolean);

  const table = document.getElementById("import-table");
  table.innerHTML = "";
  const head = table.insertRow();
  importHeaders.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (mapped.includes(h)) th.className = "mapped";
    head.append(th);
  });
  importRecords.slice(0, 5).forEach((r) => {
    const tr = table.insertRow();
    importHeaders.forEach((h) => { tr.insertCell().textContent = r[h]; });
  });

  const summary = document.getElementById("import-summary");
  const runBtn = document.getElementById("import-run");
  if (!map.date || !map.amount) {
    summary.textContent = "Choose at least the Date and Amount columns.";
    runBtn.disabled = true;
    return;
  }
  // With a Type column, income vs expense comes from it, not the amount's sign
  signSelect.disabled = !!map.type;
  document.getElementById("map-sign-label").title = map.type
    ? "Not needed: the Type column tells income from expenses." : "";

  const result = readImportRows(importRecords, map, signSelect.value === "negative");
  let text = result.expenses.length + " expenses";
  if (result.incomes.length) text += " and " + result.incomes.length + " income rows";
  text += " ready to import.";
  if (result.invalid) text += " " + result.invalid + " rows without a valid date or amount will be skipped.";
  if (!map.item) text += " No budget item column chosen: expenses will be uncategorized.";
  summary.textContent = text;
  const count = result.expenses.length + result.incomes.length;
  runBtn.disabled = count === 0;
  runBtn.textContent = "Import " + count + " rows";
}

Object.values(mapSelects).forEach((s) => s.addEventListener("change", updateImportPreview));
signSelect.addEventListener("change", updateImportPreview);
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
    readImportRows(importRecords, currentMap(), signSelect.value === "negative");
  const stats = applyImport(data, expenses, incomes, newId);
  saveData();
  refreshAfterDataChange();
  importStep.hidden = true;
  importRecords = [];

  // Tell the user exactly what happened
  const parts = [];
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
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
