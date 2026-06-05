import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_ROOT, 'config.example.json');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function resolveConfigPath(cliConfigPath) {
  if (cliConfigPath) {
    return path.resolve(cliConfigPath);
  }

  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    return DEFAULT_CONFIG_PATH;
  }

  if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
    return EXAMPLE_CONFIG_PATH;
  }

  throw new Error(
    'No config file found. Copy config.example.json to config.json or pass --config <path>.',
  );
}

export function loadConfig(cliConfigPath) {
  const configPath = resolveConfigPath(cliConfigPath);
  const config = readJsonFile(configPath);

  return {
    ...config,
    _meta: {
      configPath,
      projectRoot: PROJECT_ROOT,
    },
  };
}

export function resolvePath(baseDir, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(baseDir, targetPath);
}

export function getChainConfig(config, chainId) {
  const chainKey = String(chainId);
  const chain = config.chains?.[chainKey];

  if (!chain) {
    throw new Error(`Unsupported chain id: ${chainId}`);
  }

  return {
    chainId: Number(chainKey),
    ...chain,
  };
}

export function buildWorkerConfig(config, overrides = {}) {
  const chainId = Number(overrides.chainId);
  const chain = getChainConfig(config, chainId);
  const scraper = config.scraper ?? {};
  const chrome = config.chrome ?? {};

  const token =
    overrides.token ??
    chain.nativeToken ??
    scraper.defaultToken ??
    'eth';

  return {
    id: overrides.id ?? `worker-${chainId}-${overrides.debugPort ?? chrome.defaultDebugPort}`,
    chainId,
    chainName: chain.name,
    explorerUrl: chain.explorerUrl.replace(/\/$/, ''),
    txnType: Number(overrides.txnType ?? scraper.defaultTxnType ?? 2),
    token: String(token).toLowerCase(),
    pageSize: Number(overrides.pageSize ?? scraper.defaultPageSize ?? 100),
    debugPort: Number(overrides.debugPort ?? chrome.defaultDebugPort ?? 9300),
    maxPages: Number(overrides.maxPages ?? scraper.maxPages ?? 500),
    pageDelayMs: Number(overrides.pageDelayMs ?? scraper.pageDelayMs ?? 5000),
    restartDelayMs: Number(overrides.restartDelayMs ?? scraper.restartDelayMs ?? 10000),
    emptyPageRetryMs: Number(overrides.emptyPageRetryMs ?? scraper.emptyPageRetryMs ?? 30000),
    excludedMethods: overrides.excludedMethods ?? scraper.excludedMethods ?? [],
    chromeExecutablePath: overrides.chromeExecutablePath ?? chrome.executablePath,
    chromeHeadless: Boolean(overrides.chromeHeadless ?? chrome.headless ?? false),
    chromeReuseExisting: Boolean(
      overrides.chromeReuseExisting ?? chrome.reuseExisting ?? true,
    ),
    chromeUserDataDirBase: resolvePath(
      config._meta.projectRoot,
      overrides.chromeUserDataDirBase ?? chrome.userDataDirBase ?? './chrome-profiles',
    ),
    pageLoadTimeoutMs: Number(overrides.pageLoadTimeoutMs ?? chrome.pageLoadTimeoutMs ?? 120000),
    navigationDelayMs: Number(overrides.navigationDelayMs ?? chrome.navigationDelayMs ?? 3000),
    cloudflareWaitMs: Number(overrides.cloudflareWaitMs ?? chrome.cloudflareWaitMs ?? 15000),
    cloudflareMaxWaitMs: Number(
      overrides.cloudflareMaxWaitMs ?? chrome.cloudflareMaxWaitMs ?? 120000,
    ),
    logTransactionLimit: Number(
      overrides.logTransactionLimit ?? scraper.logTransactionLimit ?? 10,
    ),
    mongodb: {
      uri: overrides.mongodbUri ?? config.database?.uri ?? 'mongodb://127.0.0.1:27017',
      databaseName:
        overrides.mongodbDatabaseName ??
        config.database?.databaseName ??
        'contract_detect',
      collectionName:
        overrides.mongodbCollectionName ??
        config.database?.collectionName ??
        'addresses',
    },
    addressUrlFile: resolvePath(
      config._meta.projectRoot,
      overrides.addressUrlFile ??
        config.output?.addressUrlFile ??
        './address-url.md',
    ),
  };
}

export function selectWorkers(config, workerIds = []) {
  const workers = config.workers ?? [];

  if (!workerIds.length) {
    return workers;
  }

  const selected = workers.filter((worker) => workerIds.includes(worker.id));

  if (!selected.length) {
    throw new Error(`No workers matched: ${workerIds.join(', ')}`);
  }

  return selected;
}

export function parseCliArgs(argv) {
  const args = {
    config: undefined,
    workers: [],
    chainId: undefined,
    txnType: undefined,
    token: undefined,
    pageSize: undefined,
    debugPort: undefined,
    maxPages: undefined,
    workerId: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case '--config':
        args.config = argv[index + 1];
        index += 1;
        break;
      case '--workers':
        args.workers = argv[index + 1].split(',').map((value) => value.trim()).filter(Boolean);
        index += 1;
        break;
      case '--chain-id':
        args.chainId = Number(argv[index + 1]);
        index += 1;
        break;
      case '--txntype':
        args.txnType = Number(argv[index + 1]);
        index += 1;
        break;
      case '--tkn':
        args.token = argv[index + 1];
        index += 1;
        break;
      case '--ps':
        args.pageSize = Number(argv[index + 1]);
        index += 1;
        break;
      case '--debug-port':
        args.debugPort = Number(argv[index + 1]);
        index += 1;
        break;
      case '--max-pages':
        args.maxPages = Number(argv[index + 1]);
        index += 1;
        break;
      case '--worker-id':
        args.workerId = argv[index + 1];
        index += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

export function printHelp() {
  console.log(`
contract-detect-token-internal-tx-bot

Usage:
  node src/index.js
  node src/index.js --workers eth-internal-eth,bsc-internal-bnb
  node src/index.js --chain-id 1 --txntype 2 --tkn eth --debug-port 9300
  node src/worker.js --chain-id 56 --txntype 2 --tkn bnb --debug-port 9301

Options:
  --config <path>       Config file path (default: ./config.json or ./config.example.json)
  --workers <ids>       Comma-separated worker ids from config.workers
  --chain-id <id>       Chain id (1=ethereum, 56=bsc, 8453=base, 42161=arbitrum)
  --txntype <n>         Transaction type filter (default: 2)
  --tkn <token>         Token symbol or contract address (default: chain native token)
  --ps <n>              Page size / hash count (default: 100)
  --debug-port <port>   Chrome remote debugging port (default: 9300)
  --max-pages <n>       Max pages per cycle (default: 500)
  --worker-id <id>      Worker label for logs
  --help, -h            Show this help
`);
}
