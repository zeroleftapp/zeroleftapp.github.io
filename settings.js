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
document.getElementById("export-json").addEventListener("click", () => {
  downloadFile("budget-backup-" + todayString() + ".json",
    JSON.stringify(data, null, 2), "application/json");
});

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
  downloadFile("transactions-" + todayString() + ".csv", toCSV(rows), "text/csv");
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

  importRecords = [];
  importHeaders = [];
  const names = [];
  for (const file of files) {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) continue; // no data rows
    const headers = rows[0].map((h) => h.trim());
    headers.forEach((h) => { if (h && !importHeaders.includes(h)) importHeaders.push(h); });
    rows.slice(1).forEach((cells) => {
      const record = {};
      headers.forEach((h, i) => { record[h] = cells[i] || ""; });
      importRecords.push(record);
    });
    names.push(file.name);
  }

  if (!importRecords.length) {
    showImportResult("No rows found in the chosen file(s).", true);
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
  signSelect.value = looksNegative(importRecords, guess.amount) ? "negative" : "positive";

  document.getElementById("import-files").textContent =
    importRecords.length + " rows from " + names.length + " file" + (names.length > 1 ? "s" : "") +
    ": " + names.join(", ");
  importResult.hidden = true;
  importStep.hidden = false;
  updateImportPreview();
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
  const result = readImportRows(importRecords, map, signSelect.value === "negative");
  let text = result.expenses.length + " expenses ready to import.";
  if (result.income) text += " " + result.income + " income rows will be skipped.";
  if (result.invalid) text += " " + result.invalid + " rows without a valid date or amount will be skipped.";
  if (!map.item) text += " No budget item column chosen: expenses will be uncategorized.";
  summary.textContent = text;
  runBtn.disabled = result.expenses.length === 0;
  runBtn.textContent = "Import " + result.expenses.length;
}

Object.values(mapSelects).forEach((s) => s.addEventListener("change", updateImportPreview));
signSelect.addEventListener("change", updateImportPreview);
// When the amount column changes, guess the sign again
mapSelects.amount.addEventListener("change", () => {
  signSelect.value = looksNegative(importRecords, mapSelects.amount.value) ? "negative" : "positive";
  updateImportPreview();
});

document.getElementById("import-cancel").addEventListener("click", () => {
  importStep.hidden = true;
  importRecords = [];
});

document.getElementById("import-run").addEventListener("click", () => {
  const { expenses, income, invalid } =
    readImportRows(importRecords, currentMap(), signSelect.value === "negative");
  const stats = applyImport(data, expenses, newId);
  saveData();
  refreshAfterDataChange();
  importStep.hidden = true;
  importRecords = [];

  // Tell the user exactly what happened
  const parts = [];
  if (stats.added) {
    const first = monthLabel(stats.months[0]);
    const last = monthLabel(stats.months[stats.months.length - 1]);
    parts.push("Imported " + stats.added + " expenses (" + (first === last ? first : first + " – " + last) + ").");
  } else {
    parts.push("Nothing new to import.");
  }
  if (stats.monthsCreated.length) parts.push("Created " + stats.monthsCreated.length + " new month" + (stats.monthsCreated.length > 1 ? "s" : "") + ".");
  if (stats.itemsCreated) parts.push("Added " + stats.itemsCreated + " budget item" + (stats.itemsCreated > 1 ? "s" : "") + " with $0 planned: set their amounts in the Budget tab.");
  const skipped = [];
  if (stats.duplicates) skipped.push(stats.duplicates + " already imported");
  if (income) skipped.push(income + " income");
  if (invalid) skipped.push(invalid + " unreadable");
  if (skipped.length) parts.push("Skipped: " + skipped.join(", ") + ".");
  showImportResult(parts.join(" "), false);
});

function showImportResult(text, isError) {
  importResult.textContent = text;
  importResult.classList.toggle("error", isError);
  importResult.hidden = false;
}
