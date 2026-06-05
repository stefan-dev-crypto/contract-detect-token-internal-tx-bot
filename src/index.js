import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkerConfig,
  loadConfig,
  parseCliArgs,
  printHelp,
  selectWorkers,
} from './config.js';
import { createLogger } from './logger.js';
import { runWorker } from './worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerEntry = path.join(__dirname, 'worker.js');

function spawnWorkerProcess(workerConfig) {
  const logger = createLogger('main');
  const child = fork(workerEntry, [], {
    env: {
      ...process.env,
      WORKER_DIRECT: '1',
      WORKER_CONFIG_JSON: JSON.stringify(workerConfig),
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (code === 0) {
      logger.info(`Worker ${workerConfig.id} exited cleanly`);
      return;
    }

    logger.error(`Worker ${workerConfig.id} exited (code=${code}, signal=${signal})`);
  });

  return child;
}

async function runInlineWorker(workerConfig) {
  await runWorker(workerConfig);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(args.config);
  const logger = createLogger('main');

  if (args.chainId) {
    const workerConfig = buildWorkerConfig(config, {
      id: args.workerId,
      chainId: args.chainId,
      txnType: args.txnType,
      token: args.token,
      pageSize: args.pageSize,
      debugPort: args.debugPort,
      maxPages: args.maxPages,
    });

    await runInlineWorker(workerConfig);
    return;
  }

  const selectedWorkers = selectWorkers(config, args.workers);

  if (!selectedWorkers.length) {
    throw new Error('No workers configured. Add entries to config.workers or pass --chain-id.');
  }

  logger.info(`Starting ${selectedWorkers.length} worker(s) in parallel`);

  const children = selectedWorkers.map((worker) => {
    const workerConfig = buildWorkerConfig(config, worker);
    return spawnWorkerProcess(workerConfig);
  });

  const shutdown = () => {
    logger.info('Shutting down workers...');

    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
