import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import puppeteer from 'puppeteer-core';
import { buildAddressUrl, createAddressUrlStore } from './address-url.js';
import { buildAdvancedFilterUrl, normalizeAddress } from './chains.js';
import {
  buildWorkerConfig,
  loadConfig,
  selectWorkers,
} from './config.js';
import { createAddressDatabase } from './database.js';
import { filterTransactions } from './filter.js';
import { scrapeTransactions } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

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

const SAMPLE_ADVANCE_TABLE_HTML = `
<!DOCTYPE html>
<html>
  <body>
    <table id="tblAdvanceData">
      <tbody>
        <tr>
          <td class="advFilterTxHash"><a href="/tx/0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab">0xabc...</a></td>
          <td class="advFilterMethod td_functionNameCustom"><span data-title="Swap">Swap</span></td>
          <td class="advFilterFromAddress"><a data-highlight-target="0x1111111111111111111111111111111111111111" href="/address/0x1111111111111111111111111111111111111111">0x1111...1111</a></td>
          <td class="advFilterToAddress"><a data-highlight-target="0x2222222222222222222222222222222222222222" href="/address/0x2222222222222222222222222222222222222222">0x2222...2222</a></td>
        </tr>
        <tr>
          <td class="advFilterTxHash"><a href="/tx/0xdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdefdef">0xdef...</a></td>
          <td class="advFilterMethod td_functionNameCustom"><span data-title="Transfer">Transfer</span></td>
          <td class="advFilterFromAddress"><a data-highlight-target="0x3333333333333333333333333333333333333333" href="/address/0x3333333333333333333333333333333333333333">0x3333...3333</a></td>
          <td class="advFilterToAddress"><a data-highlight-target="0x4444444444444444444444444444444444444444" href="/address/0x4444444444444444444444444444444444444444">0x4444...4444</a></td>
        </tr>
        <tr>
          <td class="advFilterTxHash"><a href="/tx/0xghighighighighighighighighighighighighighighighighighighighighi">0xghi...</a></td>
          <td class="advFilterMethod td_functionNameCustom"><span data-title="Mint">Mint</span></td>
          <td class="advFilterFromAddress"><a data-highlight-target="0x7777777777777777777777777777777777777777" href="/address/0x7777777777777777777777777777777777777777">0x7777...7777</a></td>
          <td class="advFilterToAddress"><a data-highlight-target="0x8888888888888888888888888888888888888888" href="/address/0x8888888888888888888888888888888888888888">0x8888...8888</a></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

const SAMPLE_TABLE_HTML = `
<!DOCTYPE html>
<html>
  <body>
    <table>
      <thead>
        <tr>
          <th>Txn Hash</th>
          <th>Method</th>
          <th>From</th>
          <th>To</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>0xabc</td>
          <td title="Swap">Swap</td>
          <td><a href="/address/0x1111111111111111111111111111111111111111">0x1111...1111</a></td>
          <td><a href="/address/0x2222222222222222222222222222222222222222">0x2222...2222</a></td>
        </tr>
        <tr>
          <td>0xdef</td>
          <td>Transfer</td>
          <td><a href="/address/0x3333333333333333333333333333333333333333">0x3333...3333</a></td>
          <td><a href="/address/0x4444444444444444444444444444444444444444">0x4444...4444</a></td>
        </tr>
        <tr>
          <td>0xghi</td>
          <td>Approve</td>
          <td><a href="/address/0x5555555555555555555555555555555555555555">0x5555...5555</a></td>
          <td><a href="/address/0x6666666666666666666666666666666666666666">0x6666...6666</a></td>
        </tr>
        <tr>
          <td>0xjkl</td>
          <td>Mint</td>
          <td><a href="/address/0x7777777777777777777777777777777777777777">0x7777...7777</a></td>
          <td><a href="/address/0x8888888888888888888888888888888888888888">0x8888...8888</a></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

async function createTestPage(html = SAMPLE_TABLE_HTML) {
  const config = loadConfig();
  const chromePath = config.chrome?.executablePath;

  if (!chromePath || !fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found for scraper test: ${chromePath}`);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  return { browser, page };
}

async function main() {
  console.log('Running direct function tests...\n');

  await test('loadConfig reads config.json', async () => {
    const config = loadConfig();
    assert(config.chains?.['1']?.explorerUrl === 'https://etherscan.io', 'ethereum chain missing');
    assert(config.database?.uri, 'mongodb uri missing');
  });

  await test('buildWorkerConfig applies defaults and overrides', async () => {
    const config = loadConfig();
    const workerConfig = buildWorkerConfig(config, {
      id: 'test-worker',
      chainId: 1,
      debugPort: 9399,
    });

    assert(workerConfig.txnType === 2, 'default txnType should be 2');
    assert(workerConfig.pageSize === 100, 'default pageSize should be 100');
    assert(workerConfig.token === 'eth', 'default token should be eth');
    assert(workerConfig.mongodb.uri.includes('mongodb'), 'mongodb uri should be set');
    assert(workerConfig.explorerUrl === 'https://etherscan.io', 'explorer url mismatch');
  });

  await test('selectWorkers filters configured workers', async () => {
    const config = loadConfig();
    const workerId = config.workers?.[0]?.id;

    if (!workerId) {
      throw new Error('config.workers is empty');
    }

    const workers = selectWorkers(config, [workerId]);
    assert(workers.length === 1, 'expected one worker');
    assert(workers[0].id === workerId, 'wrong worker selected');
  });

  await test('buildAdvancedFilterUrl builds expected query string', async () => {
    const url = buildAdvancedFilterUrl({
      explorerUrl: 'https://etherscan.io',
      txnType: 2,
      token: 'eth',
      pageSize: 100,
      page: 3,
    });

    assert(
      url === 'https://etherscan.io/advanced-filter?txntype=2&ps=100&tkn=eth&p=3',
      `unexpected url: ${url}`,
    );
  });

  await test('buildAddressUrl formats explorer address links per chain', async () => {
    assert(
      buildAddressUrl('https://etherscan.io', '0x48afBBD342F64ef8a9AB1c143719B63C2aD81710')
        === 'https://etherscan.io/address/0x48afbbd342f64ef8a9ab1c143719b63c2ad81710',
      'ethereum address url mismatch',
    );
    assert(
      buildAddressUrl('https://bscscan.com', '0xe9c4d4f095c7943a9ef5ec01afd1385d011855a1')
        === 'https://bscscan.com/address/0xe9c4d4f095c7943a9ef5ec01afd1385d011855a1',
      'bsc address url mismatch',
    );
    assert(
      buildAddressUrl('https://basescan.org', '0x20c0bc331d9cc3d38e1e4b9be8741c6d8f47af90')
        === 'https://basescan.org/address/0x20c0bc331d9cc3d38e1e4b9be8741c6d8f47af90',
      'base address url mismatch',
    );
    assert(
      buildAddressUrl('https://arbiscan.io', '0x03339ecae41bc162dacae5c2a275c8f64d6c80a0')
        === 'https://arbiscan.io/address/0x03339ecae41bc162dacae5c2a275c8f64d6c80a0',
      'arbitrum address url mismatch',
    );
  });

  await test('address-url store appends unique urls to markdown file', async () => {
    const filePath = path.join(PROJECT_ROOT, 'data', 'test-address-url.md');
    fs.rmSync(filePath, { force: true });
    fs.rmSync(`${filePath}.lock`, { force: true });

    const store = await createAddressUrlStore({
      filePath,
      explorerUrl: 'https://etherscan.io',
    });

    const first = await store.appendAddress('0x1111111111111111111111111111111111111111');
    const duplicate = await store.appendAddress('0x1111111111111111111111111111111111111111');
    const second = await store.appendAddress('0x2222222222222222222222222222222222222222');

    assert(first, 'first url should append');
    assert(!duplicate, 'duplicate url should be skipped');
    assert(second, 'second url should append');
    assert(await store.count() === 2, 'file should contain 2 urls');

    const content = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    assert(
      content[0] === 'https://etherscan.io/address/0x1111111111111111111111111111111111111111',
      'first line mismatch',
    );

    fs.rmSync(filePath, { force: true });
    fs.rmSync(`${filePath}.lock`, { force: true });
  });

  await test('buildWorkerConfig supports base and arbitrum chains', async () => {
    const config = loadConfig();

    const base = buildWorkerConfig(config, { id: 'base-test', chainId: 8453, debugPort: 9302 });
    const arb = buildWorkerConfig(config, { id: 'arb-test', chainId: 42161, debugPort: 9303 });

    assert(base.explorerUrl === 'https://basescan.org', 'base explorer mismatch');
    assert(base.token === 'eth', 'base token should be eth');
    assert(arb.explorerUrl === 'https://arbiscan.io', 'arbitrum explorer mismatch');
    assert(arb.token === 'eth', 'arbitrum token should be eth');
  });

  await test('normalizeAddress validates and lowercases', async () => {
    assert(
      normalizeAddress('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01') ===
        '0xabcdef0123456789abcdef0123456789abcdef01',
      'address should be lowercased',
    );
    assert(normalizeAddress('not-an-address') === null, 'invalid address should be null');
  });

  await test('filterTransactions excludes Transfer/Approve/Exec methods', async () => {
    const transactions = [
      { method: 'Swap', action: '', from: '0x1', to: '0x2' },
      { method: 'Transfer', action: '', from: '0x3', to: '0x4' },
      { method: 'Transfer From', action: '', from: '0x5', to: '0x6' },
      { method: 'Approve', action: '', from: '0x7', to: '0x8' },
      { method: 'Exec', action: '', from: '0x9', to: '0xa' },
      { method: 'Mint', action: '', from: '0xb', to: '0xc' },
    ];

    const kept = filterTransactions(transactions, [
      'Transfer',
      'Transfer From',
      'Approve',
      'Exec',
    ]);

    assert(kept.length === 2, `expected 2 kept transactions, got ${kept.length}`);
    assert(kept[0].method === 'Swap', 'Swap should be kept');
    assert(kept[1].method === 'Mint', 'Mint should be kept');
  });

  const memoryServer = await MongoMemoryServer.create();
  const mongoUri = memoryServer.getUri();

  await test('MongoDB createAddressDatabase stores unique addresses', async () => {
    const db = await createAddressDatabase({
      uri: mongoUri,
      databaseName: 'test_contract_detect',
      collectionName: 'test_addresses',
    });

    const chainId = 1;
    const from = '0x1111111111111111111111111111111111111111';
    const to = '0x2222222222222222222222222222222222222222';

    const firstInsert = await db.recordTransactionAddresses(chainId, from, to);
    assert(firstInsert.length === 2, 'first insert should add from and to');

    const secondInsert = await db.recordTransactionAddresses(chainId, from, to);
    assert(secondInsert.length === 0, 'duplicate insert should add nothing');

    assert(await db.exists(chainId, from), 'from address should exist');
    assert(await db.exists(chainId, to), 'to address should exist');
    assert(await db.countByChain(chainId) === 2, 'chain count should be 2');

    await db.close();
  });

  await test('MongoDB recordAddress handles duplicate key gracefully', async () => {
    const db = await createAddressDatabase({
      uri: mongoUri,
      databaseName: 'test_contract_detect',
      collectionName: 'test_addresses_dup',
    });

    const chainId = 56;
    const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    assert(await db.recordAddress(chainId, address, 'from'), 'first record should succeed');
    assert(!(await db.recordAddress(chainId, address, 'to')), 'duplicate record should fail');

    await db.close();
  });

  await test('scrapeTransactions parses etherscan #tblAdvanceData rows', async () => {
    const { browser, page } = await createTestPage(SAMPLE_ADVANCE_TABLE_HTML);

    try {
      const transactions = await scrapeTransactions(page);
      assert(transactions.length === 3, `expected 3 rows, got ${transactions.length}`);

      const swap = transactions.find((tx) => tx.method === 'Swap');
      assert(swap?.from === '0x1111111111111111111111111111111111111111', 'swap from mismatch');
      assert(swap?.to === '0x2222222222222222222222222222222222222222', 'swap to mismatch');
    } finally {
      await browser.close();
    }
  });

  await test('scrapeTransactions parses Method/From/To from generic table HTML', async () => {
    const { browser, page } = await createTestPage();

    try {
      const transactions = await scrapeTransactions(page);
      assert(transactions.length === 4, `expected 4 rows, got ${transactions.length}`);

      const swap = transactions.find((tx) => tx.method === 'Swap');
      assert(swap?.from === '0x1111111111111111111111111111111111111111', 'swap from mismatch');
      assert(swap?.to === '0x2222222222222222222222222222222222222222', 'swap to mismatch');
    } finally {
      await browser.close();
    }
  });

  await test('scrape + filter + database pipeline works end-to-end', async () => {
    const config = loadConfig();
    const excludedMethods = config.scraper.excludedMethods;
    const db = await createAddressDatabase({
      uri: mongoUri,
      databaseName: 'test_contract_detect',
      collectionName: 'test_pipeline',
    });

    const { browser, page } = await createTestPage();

    try {
      const scraped = await scrapeTransactions(page);
      const kept = filterTransactions(scraped, excludedMethods);
      assert(kept.length === 2, `pipeline should keep 2 txs, got ${kept.length}`);

      let insertedTotal = 0;

      for (const transaction of kept) {
        const inserted = await db.recordTransactionAddresses(
          1,
          transaction.from,
          transaction.to,
        );
        insertedTotal += inserted.length;
      }

      assert(insertedTotal === 4, `expected 4 inserted addresses, got ${insertedTotal}`);
      assert(await db.countByChain(1) === 4, 'pipeline count should be 4');
    } finally {
      await browser.close();
      await db.close();
    }
  });

  await memoryServer.stop();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
