export function buildAdvancedFilterUrl({
  explorerUrl,
  txnType,
  token,
  pageSize,
  page,
}) {
  const params = new URLSearchParams();

  params.set('txntype', String(txnType));
  params.set('ps', String(pageSize));
  params.set('tkn', token);
  params.set('p', String(page));

  return `${explorerUrl}/advanced-filter?${params.toString()}`;
}

export function normalizeAddress(address) {
  if (!address) {
    return null;
  }

  const trimmed = String(address).trim().toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}
