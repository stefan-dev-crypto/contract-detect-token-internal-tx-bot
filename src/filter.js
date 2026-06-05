function normalizeMethodName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function createMethodFilter(excludedMethods = []) {
  const excluded = new Set(
    excludedMethods.map((method) => normalizeMethodName(method)),
  );

  return {
    isExcluded(methodOrAction) {
      const normalized = normalizeMethodName(methodOrAction);

      if (!normalized) {
        return false;
      }

      return excluded.has(normalized);
    },
  };
}

export function filterTransactions(transactions, excludedMethods = []) {
  const methodFilter = createMethodFilter(excludedMethods);

  return transactions.filter((transaction) => {
    const label = transaction.method || transaction.action || '';
    return !methodFilter.isExcluded(label);
  });
}
