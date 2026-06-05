import { buildAdvancedFilterUrl } from './chains.js';
import { ChromeSession } from './chrome.js';
import { buildWorkerConfig, loadConfig, selectWorkers } from './config.js';
import { filterTransactions } from './filter.js';
import { createLogger } from './logger.js';
import { scrapeTransactions } from './scraper.js';

const VERIFY_DEBUG_PORT_BASE = 9380;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function verifyChainFetch(config, worker, verifyPort) {
  const workerConfig = buildWorkerConfig(config, {
    ...worker,
    debugPort: verifyPort,
    chromeReuseExisting: false,
  });

  const logger = createLogger(`verify-${worker.id}`);
  const chrome = new ChromeSession(workerConfig, logger);

  const url = buildAdvancedFilterUrl({
    explorerUrl: workerConfig.explorerUrl,
    txnType: workerConfig.txnType,
    token: workerConfig.token,
    pageSize: workerConfig.pageSize,
    page: 1,
  });

  try {
    await chrome.ensureChromeRunning(url);
    await chrome.connect();
    await chrome.navigate(url);

    const state = await chrome.getPageState();
    const transactions = await scrapeTransactions(chrome.page);
    const kept = filterTransactions(transactions, workerConfig.excludedMethods);

    assert(!state.isCloudflare, 'still blocked by Cloudflare');
    assert(state.dataRowCount > 0, `no data rows (rows=${state.rowCount}, dataRows=${state.dataRowCount})`);
    assert(transactions.length > 0, 'scraper returned 0 transactions');

    const sample = transactions[0];
    assert(sample.hash, 'first transaction missing hash');
    assert(sample.from || sample.to, 'first transaction missing from/to address');
    assert(
      /^0x[a-f0-9]{40}$/.test(sample.from || '') || /^0x[a-f0-9]{40}$/.test(sample.to || ''),
      'first transaction has no valid hex address',
    );

    console.log(`  chain=${workerConfig.chainName} (${workerConfig.chainId})`);
    console.log(`  url=${url}`);
    console.log(`  scraped=${transactions.length} kept=${kept.length}`);
    console.log(
      `  sample method="${sample.method || sample.action}" from=${sample.from ?? '-'} to=${sample.to ?? '-'}`,
    );
  } finally {
    await chrome.close();
  }
}

async function main() {
  const config = loadConfig();
  const expectedChainIds = [1, 56, 8453, 42161];
  const workers = selectWorkers(config, []);

  console.log('Verifying chain support and live transaction fetching...\n');

  await test('config defines all required chains', async () => {
    for (const chainId of expectedChainIds) {
      assert(config.chains?.[String(chainId)], `missing chain config for ${chainId}`);
    }
  });

  await test('workers configured for ethereum, bsc, base, arbitrum', async () => {
    const workerChainIds = workers.map((worker) => worker.chainId).sort((a, b) => a - b);
    assert(
      JSON.stringify(workerChainIds) === JSON.stringify(expectedChainIds),
      `worker chain ids mismatch: ${JSON.stringify(workerChainIds)}`,
    );
  });

  for (const [index, worker] of workers.entries()) {
    const verifyPort = VERIFY_DEBUG_PORT_BASE + index;

    await test(`live fetch works for ${worker.id} (chain ${worker.chainId})`, async () => {
      await verifyChainFetch(config, worker, verifyPort);
    });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Chain verification failed:', error);
  process.exit(1);
});
