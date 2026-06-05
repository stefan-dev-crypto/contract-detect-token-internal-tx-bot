import './bootstrap.js';
import { buildAdvancedFilterUrl } from './chains.js';
import { ChromeSession } from './chrome.js';
import {
  buildWorkerConfig,
  loadConfig,
  parseCliArgs,
  printHelp,
} from './config.js';
import { createAddressUrlStore } from './address-url.js';
import { createAddressDatabase } from './database.js';
import { filterTransactions } from './filter.js';
import { createLogger } from './logger.js';
import { scrapeTransactions } from './scraper.js';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logTransactions(logger, transactions, label, limit = 10) {
  if (!transactions.length) {
    logger.info(`${label}: no transactions`);
    return;
  }

  logger.info(`${label}: ${transactions.length} transaction(s)`);

  for (const [index, transaction] of transactions.slice(0, limit).entries()) {
    logger.info(
      `  [${index + 1}] method="${transaction.method || transaction.action || '-'}" ` +
        `from=${transaction.from ?? '-'} to=${transaction.to ?? '-'} ` +
        `hash=${transaction.hash ?? '-'}`,
    );
  }

  if (transactions.length > limit) {
    logger.info(`  ... and ${transactions.length - limit} more`);
  }
}

export async function runWorker(rawWorkerConfig) {
  const logger = createLogger(rawWorkerConfig.id);
  const database = await createAddressDatabase(rawWorkerConfig.mongodb);
  const addressUrlStore = await createAddressUrlStore({
    filePath: rawWorkerConfig.addressUrlFile,
    explorerUrl: rawWorkerConfig.explorerUrl,
  });
  const chrome = new ChromeSession(rawWorkerConfig, logger);

  let cycle = 0;

  logger.info(
    `Starting worker chain=${rawWorkerConfig.chainName} (${rawWorkerConfig.chainId}) ` +
      `txntype=${rawWorkerConfig.txnType} tkn=${rawWorkerConfig.token} ` +
      `ps=${rawWorkerConfig.pageSize} debugPort=${rawWorkerConfig.debugPort} ` +
      `addressUrlFile=${rawWorkerConfig.addressUrlFile}`,
  );

  const firstUrl = buildAdvancedFilterUrl({
    explorerUrl: rawWorkerConfig.explorerUrl,
    txnType: rawWorkerConfig.txnType,
    token: rawWorkerConfig.token,
    pageSize: rawWorkerConfig.pageSize,
    page: 1,
  });

  try {
    await chrome.ensureChromeRunning(firstUrl);
    await chrome.connect();

    while (true) {
      cycle += 1;
      logger.info(`Cycle ${cycle} started (pages 1-${rawWorkerConfig.maxPages})`);

      let cycleInserted = 0;

      for (let page = 1; page <= rawWorkerConfig.maxPages; page += 1) {
        const url = buildAdvancedFilterUrl({
          explorerUrl: rawWorkerConfig.explorerUrl,
          txnType: rawWorkerConfig.txnType,
          token: rawWorkerConfig.token,
          pageSize: rawWorkerConfig.pageSize,
          page,
        });

        await chrome.navigate(url);
        let transactions = await scrapeTransactions(chrome.page);

        if (!transactions.length) {
          logger.warn(
            `Page ${page} returned no parseable rows on ${rawWorkerConfig.explorerUrl}; ` +
              'waiting for async table data before retry',
          );
          await sleep(rawWorkerConfig.emptyPageRetryMs);
          await chrome.waitForContent();
          transactions = await scrapeTransactions(chrome.page);

          if (!transactions.length) {
            await chrome.navigate(url);
            transactions = await scrapeTransactions(chrome.page);
          }
        }

        logTransactions(
          logger,
          transactions,
          `Page ${page} scraped`,
          rawWorkerConfig.logTransactionLimit,
        );

        const kept = filterTransactions(transactions, rawWorkerConfig.excludedMethods);

        logTransactions(
          logger,
          kept,
          `Page ${page} kept after filter`,
          rawWorkerConfig.logTransactionLimit,
        );

        if (transactions.length > 0 && kept.length === 0) {
          logger.warn(
            `Page ${page}: all ${transactions.length} scraped transactions were excluded by method filter ` +
              `(Transfer/Approve/Exec etc.). Adjust excludedMethods in config if needed.`,
          );
        }

        let pageInserted = 0;

        for (const transaction of kept) {
          const inserted = await database.recordTransactionAddresses(
            rawWorkerConfig.chainId,
            transaction.from,
            transaction.to,
          );

          for (const item of inserted) {
            await addressUrlStore.appendAddress(item.address);
          }

          pageInserted += inserted.length;
          cycleInserted += inserted.length;
        }

        const totalAddresses = await database.countByChain(rawWorkerConfig.chainId);

        logger.info(
          `Page ${page}/${rawWorkerConfig.maxPages}: scraped=${transactions.length} ` +
            `kept=${kept.length} inserted=${pageInserted} ` +
            `totalAddresses=${totalAddresses}`,
        );

        await sleep(rawWorkerConfig.pageDelayMs);
      }

      const cycleTotalAddresses = await database.countByChain(rawWorkerConfig.chainId);

      logger.info(
        `Cycle ${cycle} finished. inserted=${cycleInserted} ` +
          `totalAddresses=${cycleTotalAddresses}. ` +
          `Restarting from page 1 in ${rawWorkerConfig.restartDelayMs}ms`,
      );

      await sleep(rawWorkerConfig.restartDelayMs);
    }
  } catch (error) {
    logger.error('Worker failed:', error);
    throw error;
  } finally {
    await database.close();
    await chrome.close();
  }
}

async function main() {
  if (process.env.WORKER_CONFIG_JSON) {
    const workerConfig = JSON.parse(process.env.WORKER_CONFIG_JSON);
    await runWorker(workerConfig);
    return;
  }

  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(args.config);

  if (!args.chainId) {
    throw new Error('worker.js requires --chain-id or WORKER_CONFIG_JSON');
  }

  const workerConfig = buildWorkerConfig(config, {
    id: args.workerId,
    chainId: args.chainId,
    txnType: args.txnType,
    token: args.token,
    pageSize: args.pageSize,
    debugPort: args.debugPort,
    maxPages: args.maxPages,
  });

  await runWorker(workerConfig);
}

const isWorkerEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('/worker.js');

if (process.env.WORKER_DIRECT === '1' || isWorkerEntry) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
