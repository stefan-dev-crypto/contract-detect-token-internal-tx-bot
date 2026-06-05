import { MongoClient } from 'mongodb';
import { loadConfig, parseCliArgs } from './config.js';

function parseEmptyArgs(argv) {
  const base = parseCliArgs(argv);
  return {
    ...base,
    yes: argv.includes('--yes') || argv.includes('-y'),
    chainId: (() => {
      const index = argv.indexOf('--chain-id');
      return index >= 0 ? Number(argv[index + 1]) : undefined;
    })(),
  };
}

async function main() {
  const args = parseEmptyArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const { uri, databaseName, collectionName } = {
    uri: config.database?.uri ?? 'mongodb://127.0.0.1:27017',
    databaseName: config.database?.databaseName ?? 'contract_detect',
    collectionName: config.database?.collectionName ?? 'addresses',
  };

  if (!args.yes) {
    console.log('This will delete address records from MongoDB.');
    console.log(`Target: ${uri} / ${databaseName}.${collectionName}`);
    if (args.chainId) {
      console.log(`Chain filter: ${args.chainId}`);
    }
    console.log('');
    console.log('Run again with --yes to confirm:');
    console.log('  npm run db:empty -- --yes');
    if (args.chainId) {
      console.log(`  npm run db:empty -- --yes --chain-id ${args.chainId}`);
    }
    return;
  }

  const filter = Number.isFinite(args.chainId) ? { chain_id: args.chainId } : {};
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const collection = client.db(databaseName).collection(collectionName);
    const before = await collection.countDocuments(filter);
    const result = await collection.deleteMany(filter);
    const after = await collection.countDocuments(filter);

    console.log('Database emptied');
    console.log('================');
    console.log(`MongoDB URI:      ${uri}`);
    console.log(`Database:         ${databaseName}`);
    console.log(`Collection:       ${collectionName}`);
    console.log(`Filter:           ${JSON.stringify(filter)}`);
    console.log(`Deleted:          ${result.deletedCount}`);
    console.log(`Before count:     ${before}`);
    console.log(`After count:      ${after}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Failed to empty database:', error.message);
  process.exit(1);
});
