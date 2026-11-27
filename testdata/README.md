# Test files

Sample files for trying the EveryDollar import. Not real data.

- `everydollar-2026-09.csv`, `everydollar-2026-10.csv`: simple format
  (Date, Merchant, Amount, Budget Group, Budget Item).
- `1a2b3c4d-08-2026-EveryDollar-Transactions.csv`: our best guess at
  EveryDollar's real transaction export (Group, Item, Type, Date, Merchant,
  Account, Amount, Note; MM/DD/YYYY; spending negative). Based on
  third-party descriptions, not on a real exported file. Includes a refund
  row (positive amount with Type "Expense").
- `1a2b3c4d-08-2026-EveryDollar-BudgetItems.csv`: EveryDollar's budget
  summary export (Planned / Spent / Remaining). The import should skip it
  and explain why.

Bank and other-app files (for "Import from another app or bank"):

- `bank-one-amount-column.csv`: one Amount column, spending negative,
  extra Post Date / Type / Category columns, a refund.
- `bank-debit-credit-columns.csv`: separate Debit and Credit columns,
  ISO dates.
- `bank-with-summary-lines.csv`: summary lines above the real header row,
  a "Beginning balance" row without an amount, and a Running Bal. column.
- `bank-12-rows.csv`: 12 rows (more than the 5 shown at first), for
  trying "Show all". Includes a credit card payment to uncheck.
- `bank-no-header-row.csv`: no header row at all; columns are guessed
  from their contents.
