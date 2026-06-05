import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { loadConfig, parseCliArgs, resolvePath } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function formatChainName(config, chainId) {
  const chain = config.chains?.[String(chainId)];
  return chain ? `${chain.name} (${chainId})` : `chain ${chainId}`;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const { uri, databaseName, collectionName } = {
    uri: config.database?.uri ?? 'mongodb://127.0.0.1:27017',
    databaseName: config.database?.databaseName ?? 'contract_detect',
    collectionName: config.database?.collectionName ?? 'addresses',
  };

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(databaseName);
    const collection = db.collection(collectionName);

    const total = await collection.countDocuments();
    const byChain = await collection
      .aggregate([
        {
          $group: {
            _id: '$chain_id',
            total: { $sum: 1 },
            fromCount: {
              $sum: { $cond: [{ $eq: ['$role', 'from'] }, 1, 0] },
            },
            toCount: {
              $sum: { $cond: [{ $eq: ['$role', 'to'] }, 1, 0] },
            },
            latestSeen: { $max: '$first_seen_at' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const latest = await collection
      .find({}, { projection: { chain_id: 1, address: 1, role: 1, first_seen_at: 1 } })
      .sort({ first_seen_at: -1 })
      .limit(5)
      .toArray();

    const indexes = await collection.indexes();

    console.log('Database status');
    console.log('================');
    console.log(`MongoDB URI:      ${uri}`);
    console.log(`Database:         ${databaseName}`);
    console.log(`Collection:       ${collectionName}`);
    console.log(`Total addresses:  ${total}`);

    const addressUrlFile = resolvePath(
      PROJECT_ROOT,
      config.output?.addressUrlFile ?? './address-url.md',
    );

    if (fs.existsSync(addressUrlFile)) {
      const urlCount = fs.readFileSync(addressUrlFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length;

      console.log(`Address URL file: ${addressUrlFile}`);
      console.log(`Address URLs:     ${urlCount}`);
    } else {
      console.log(`Address URL file: ${addressUrlFile} (not created yet)`);
    }

    console.log('');

    if (!byChain.length) {
      console.log('No addresses stored yet.');
      return;
    }

    console.log('By chain');
    console.log('--------');
    for (const row of byChain) {
      console.log(
        `${formatChainName(config, row._id)}: total=${row.total} ` +
          `from=${row.fromCount} to=${row.toCount} latest=${row.latestSeen ?? '-'}`,
      );
    }

    console.log('');
    console.log('Latest entries');
    console.log('--------------');
    for (const doc of latest) {
      console.log(
        `${doc.first_seen_at} chain=${doc.chain_id} role=${doc.role} address=${doc.address}`,
      );
    }

    console.log('');
    console.log('Indexes');
    console.log('-------');
    for (const index of indexes) {
      console.log(`${index.name}: ${JSON.stringify(index.key)}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Failed to read database status:', error.message);
  process.exit(1);
});
