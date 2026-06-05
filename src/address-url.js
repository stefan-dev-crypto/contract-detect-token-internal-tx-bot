import fs from 'node:fs';
import path from 'node:path';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildAddressUrl(explorerUrl, address) {
  const base = explorerUrl.replace(/\/$/, '');
  const normalized = String(address).trim().toLowerCase();
  return `${base}/address/${normalized}`;
}

function readExistingUrls(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return new Set(lines);
}

async function acquireLock(lockPath, maxRetries = 100, retryMs = 50) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      return fd;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      await wait(retryMs);
    }
  }

  throw new Error(`Could not acquire lock: ${lockPath}`);
}

function releaseLock(lockPath, fd) {
  fs.closeSync(fd);

  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Lock may already be gone.
  }
}

export async function createAddressUrlStore({ filePath, explorerUrl }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lockPath = `${filePath}.lock`;

  return {
    filePath,
    explorerUrl,

    buildUrl(address) {
      return buildAddressUrl(explorerUrl, address);
    },

    async appendAddress(address) {
      const url = buildAddressUrl(explorerUrl, address);
      const fd = await acquireLock(lockPath);

      try {
        const existing = readExistingUrls(filePath);

        if (existing.has(url)) {
          return false;
        }

        fs.appendFileSync(filePath, `${url}\n`, 'utf8');
        return true;
      } finally {
        releaseLock(lockPath, fd);
      }
    },

    async appendAddresses(addresses) {
      const appended = [];

      for (const address of addresses) {
        if (await this.appendAddress(address)) {
          appended.push(buildAddressUrl(explorerUrl, address));
        }
      }

      return appended;
    },

    async count() {
      const fd = await acquireLock(lockPath);

      try {
        return readExistingUrls(filePath).size;
      } finally {
        releaseLock(lockPath, fd);
      }
    },
  };
}
