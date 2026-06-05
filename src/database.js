import { MongoClient } from 'mongodb';

export async function createAddressDatabase({
  uri,
  databaseName,
  collectionName,
}) {
  const client = new MongoClient(uri);
  await client.connect();

  const collection = client.db(databaseName).collection(collectionName);

  await collection.createIndex(
    { chain_id: 1, address: 1 },
    { unique: true, name: 'uniq_chain_address' },
  );

  await collection.createIndex(
    { chain_id: 1 },
    { name: 'idx_chain_id' },
  );

  return {
    async exists(chainId, address) {
      const doc = await collection.findOne(
        { chain_id: chainId, address },
        { projection: { _id: 1 } },
      );

      return Boolean(doc);
    },

    async recordAddress(chainId, address, role) {
      try {
        await collection.insertOne({
          chain_id: chainId,
          address,
          role,
          first_seen_at: new Date().toISOString(),
        });

        return true;
      } catch (error) {
        if (error.code === 11000) {
          return false;
        }

        throw error;
      }
    },

    async recordTransactionAddresses(chainId, fromAddress, toAddress) {
      const inserted = [];

      if (fromAddress) {
        const fromExists = await this.exists(chainId, fromAddress);

        if (!fromExists && (await this.recordAddress(chainId, fromAddress, 'from'))) {
          inserted.push({ address: fromAddress, role: 'from' });
        }
      }

      if (toAddress) {
        const toExists = await this.exists(chainId, toAddress);

        if (!toExists && (await this.recordAddress(chainId, toAddress, 'to'))) {
          inserted.push({ address: toAddress, role: 'to' });
        }
      }

      return inserted;
    },

    async countByChain(chainId) {
      return collection.countDocuments({ chain_id: chainId });
    },

    async close() {
      await client.close();
    },
  };
}
