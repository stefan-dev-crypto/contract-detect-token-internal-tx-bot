export async function scrapeTransactions(page) {
  return page.evaluate(() => {
    function normalizeAddress(value) {
      if (!value) {
        return null;
      }

      const match = String(value).match(/(0x[a-fA-F0-9]{40})/i);
      return match ? match[1].toLowerCase() : null;
    }

    function extractAddressFromCell(cell) {
      if (!cell) {
        return null;
      }

      const candidates = [];

      for (const element of cell.querySelectorAll(
        'a[data-highlight-target], a[href*="/address/"], [data-clipboard-text]',
      )) {
        candidates.push(
          element.getAttribute('data-highlight-target'),
          element.getAttribute('data-clipboard-text'),
          element.getAttribute('href'),
        );
      }

      for (const value of candidates) {
        const address = normalizeAddress(value);
        if (address) {
          return address;
        }
      }

      return normalizeAddress(cell.textContent);
    }

    function getMethodOrAction(row) {
      const methodCells = Array.from(row.querySelectorAll('td.advFilterMethod'));

      for (const cell of methodCells) {
        if (cell.style.display === 'none') {
          continue;
        }

        const badge = cell.querySelector('span[data-title], span[data-bs-title]');
        const label = badge?.getAttribute('data-title')
          || badge?.getAttribute('data-bs-title')
          || badge?.textContent
          || cell.textContent;

        const normalized = String(label ?? '').trim().replace(/\s+/g, ' ');
        if (normalized) {
          return normalized;
        }
      }

      return '';
    }

    function parseAdvanceDataRow(row) {
      const hashCell = row.querySelector('td.advFilterTxHash a[href*="/tx/"]');
      const hash = hashCell?.getAttribute('href')?.match(/\/tx\/(0x[a-fA-F0-9]{64})/i)?.[1]?.toLowerCase()
        || hashCell?.textContent?.trim()
        || null;

      const method = getMethodOrAction(row);
      const from = extractAddressFromCell(row.querySelector('td.advFilterFromAddress'));
      const to = extractAddressFromCell(row.querySelector('td.advFilterToAddress'));

      if (!from && !to) {
        return null;
      }

      return {
        hash,
        method,
        action: method,
        from,
        to,
      };
    }

    function parseGenericRow(row, headers) {
      function getCellText(cell) {
        if (!cell) {
          return '';
        }

        const title = cell.getAttribute('data-bs-title') || cell.getAttribute('title');
        const span = cell.querySelector('span[title], span[data-bs-title], span[data-title]');
        const spanTitle = span?.getAttribute('data-title')
          || span?.getAttribute('data-bs-title')
          || span?.getAttribute('title');

        return (spanTitle || title || cell.textContent || '')
          .trim()
          .replace(/\s+/g, ' ');
      }

      function findColumnIndex(candidates) {
        const normalizedHeaders = headers.map((header) => header.toLowerCase());

        for (const candidate of candidates) {
          const index = normalizedHeaders.findIndex((header) =>
            header === candidate.toLowerCase() || header.startsWith(`${candidate.toLowerCase()} `),
          );

          if (index >= 0) {
            return index;
          }
        }

        return -1;
      }

      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) {
        return null;
      }

      const methodIndex = findColumnIndex(['method', 'action', 'method id']);
      const fromIndex = findColumnIndex(['from']);
      const toIndex = findColumnIndex(['to']);

      const method = methodIndex >= 0 ? getCellText(cells[methodIndex]) : '';
      const from = extractAddressFromCell(fromIndex >= 0 ? cells[fromIndex] : null);
      const to = extractAddressFromCell(toIndex >= 0 ? cells[toIndex] : null);

      if (!from && !to) {
        return null;
      }

      return {
        hash: null,
        method,
        action: method,
        from,
        to,
      };
    }

    const advanceTable = document.querySelector('#tblAdvanceData');

    if (advanceTable) {
      return Array.from(advanceTable.querySelectorAll('tbody tr'))
        .map(parseAdvanceDataRow)
        .filter(Boolean);
    }

    const tables = Array.from(document.querySelectorAll('table'));
    const candidateTables = tables.filter((table) => table.querySelector('tbody tr'));

    if (!candidateTables.length) {
      return [];
    }

    const preferred = candidateTables.find((table) => {
      const headers = Array.from(table.querySelectorAll('thead th, thead td')).map((cell) =>
        (cell.textContent ?? '').trim().toLowerCase(),
      );

      return headers.some((header) => header.startsWith('from'));
    });

    const table = preferred ?? candidateTables[0];
    const headerRows = Array.from(table.querySelectorAll('thead tr'));
    const headerCells = headerRows.length
      ? Array.from(headerRows[headerRows.length - 1].querySelectorAll('th, td'))
      : [];
    const headers = headerCells.map((cell) => (cell.textContent ?? '').trim().replace(/\s+/g, ' '));

    return Array.from(table.querySelectorAll('tbody tr'))
      .map((row) => parseGenericRow(row, headers))
      .filter(Boolean);
  });
}
