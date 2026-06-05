import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDebugPortOpen(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

export class ChromeSession {
  constructor(workerConfig, logger) {
    this.workerConfig = workerConfig;
    this.logger = logger;
    this.chromeProcess = null;
    this.browser = null;
    this.page = null;
  }

  get userDataDir() {
    return path.join(
      this.workerConfig.chromeUserDataDirBase,
      `${this.workerConfig.id}-port-${this.workerConfig.debugPort}`,
    );
  }

  get explorerHost() {
    return new URL(this.workerConfig.explorerUrl).hostname;
  }

  async ensureChromeRunning(initialUrl) {
    if (
      this.workerConfig.chromeReuseExisting &&
      (await isDebugPortOpen(this.workerConfig.debugPort))
    ) {
      this.logger.info(
        `Reusing existing Chrome on debug port ${this.workerConfig.debugPort}. ` +
          `Look for the ${this.explorerHost} tab in that Chrome window.`,
      );
      return;
    }

    if (!this.workerConfig.chromeExecutablePath) {
      throw new Error('chrome.executablePath is missing in config');
    }

    if (!fs.existsSync(this.workerConfig.chromeExecutablePath)) {
      throw new Error(
        `Chrome executable not found: ${this.workerConfig.chromeExecutablePath}`,
      );
    }

    fs.mkdirSync(this.userDataDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${this.workerConfig.debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-features=TranslateUI',
      '--start-maximized',
      '--new-window',
      initialUrl,
    ];

    if (this.workerConfig.chromeHeadless) {
      args.unshift('--headless=new');
    }

    this.logger.info(
      `Launching Chrome window on debug port ${this.workerConfig.debugPort} ` +
        `(headless=${this.workerConfig.chromeHeadless}): ${this.workerConfig.chromeExecutablePath}`,
    );
    this.logger.info(`Explorer URL: ${initialUrl}`);

    this.chromeProcess = spawn(this.workerConfig.chromeExecutablePath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });

    this.chromeProcess.on('exit', (code, signal) => {
      this.logger.warn(`Chrome exited (code=${code}, signal=${signal})`);
    });

    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      if (await isDebugPortOpen(this.workerConfig.debugPort)) {
        return;
      }

      await wait(500);
    }

    throw new Error(
      `Chrome debug port ${this.workerConfig.debugPort} did not become ready in time`,
    );
  }

  async connect() {
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.workerConfig.debugPort}`,
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    const matchingPage = pages.find((page) => {
      try {
        const hostname = new URL(page.url()).hostname;
        return hostname === this.explorerHost || hostname.endsWith(`.${this.explorerHost}`);
      } catch {
        return false;
      }
    });

    this.page = matchingPage ?? pages[0] ?? (await this.browser.newPage());

    try {
      await this.page.bringToFront();
    } catch {
      // Best effort only.
    }

    this.logger.info(
      `Connected to Chrome on port ${this.workerConfig.debugPort} ` +
        `(tab: ${this.page.url() || 'about:blank'}).`,
    );
  }

  async navigate(url) {
    if (!this.page) {
      throw new Error('Chrome page is not connected');
    }

    this.logger.info(`Navigating: ${url}`);

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.workerConfig.pageLoadTimeoutMs,
    });

    await wait(this.workerConfig.navigationDelayMs);
    await this.waitForContent();
  }

  async getPageState() {
    return this.page.evaluate(() => {
      function rowHasAddressData(row) {
        const fromCell = row.querySelector('td.advFilterFromAddress');
        const toCell = row.querySelector('td.advFilterToAddress');

        const selectors = [
          'a[data-highlight-target]',
          'a[href*="/address/"]',
          '[data-clipboard-text]',
        ];

        for (const cell of [fromCell, toCell]) {
          if (!cell) {
            continue;
          }

          for (const selector of selectors) {
            const element = cell.querySelector(selector);
            if (!element) {
              continue;
            }

            const value =
              element.getAttribute('data-highlight-target')
              || element.getAttribute('data-clipboard-text')
              || element.getAttribute('href')
              || '';

            if (/0x[a-fA-F0-9]{40}/.test(value)) {
              return true;
            }
          }
        }

        return false;
      }

      const rows = Array.from(document.querySelectorAll('#tblAdvanceData tbody tr'));
      const dataRows = rows.filter(rowHasAddressData);
      const bodyText = document.body?.innerText ?? '';

      return {
        title: document.title,
        isCloudflare: document.title.includes('Just a moment'),
        rowCount: rows.length,
        dataRowCount: dataRows.length,
        hasAdvanceTable: Boolean(document.querySelector('#tblAdvanceData')),
        noRecords:
          bodyText.includes('No matching records')
          || bodyText.includes('No records found')
          || bodyText.includes('No data available'),
        isLoading:
          bodyText.includes('Loading')
          || Boolean(document.querySelector('#tblAdvanceData .fa-spinner, #tblAdvanceData .spinner')),
      };
    });
  }

  async waitForContent() {
    const deadline = Date.now() + this.workerConfig.cloudflareMaxWaitMs;
    let lastState = null;

    while (Date.now() < deadline) {
      lastState = await this.getPageState();

      if (lastState.isCloudflare) {
        this.logger.info('Waiting for Cloudflare verification...');
        await wait(2000);
        continue;
      }

      if (lastState.noRecords) {
        this.logger.warn('Explorer returned no matching records for this filter');
        return;
      }

      if (lastState.dataRowCount > 0) {
        this.logger.info(
          `Advanced filter data ready (${lastState.dataRowCount}/${lastState.rowCount} rows with addresses)`,
        );
        return;
      }

      if (lastState.hasAdvanceTable && lastState.rowCount > 0) {
        this.logger.info(
          `Table visible (${lastState.rowCount} row(s)) but transaction data still loading on ${this.explorerHost}...`,
        );
      } else if (lastState.isLoading) {
        this.logger.info('Waiting for explorer table to finish loading...');
      }

      await wait(2000);
    }

    this.logger.warn(
      `Advanced filter data not ready after ${this.workerConfig.cloudflareMaxWaitMs}ms ` +
        `(title="${lastState?.title ?? 'unknown'}", rows=${lastState?.rowCount ?? 0}, ` +
        `dataRows=${lastState?.dataRowCount ?? 0}). ` +
        'Complete Cloudflare verification in the Chrome window if needed.',
    );
  }

  async evaluate(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }

  async close() {
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
      this.page = null;
    }

    if (this.chromeProcess && !this.chromeProcess.killed) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }
  }
}
