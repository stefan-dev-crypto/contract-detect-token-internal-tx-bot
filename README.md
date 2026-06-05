# contract-detect-token-internal-tx-bot

JavaScript bot that scrapes Etherscan-family **Advanced Filter** pages, filters transactions by Method/Action, and stores unique `from` / `to` addresses in MongoDB.

Uses a real Chrome executable with remote debugging (not Playwright) to reduce Cloudflare automation blocking.

## Features

- Fetch transactions from `<explorer>/advanced-filter`
- Default filters: `txntype=2`, `ps=100`, `tkn=eth` (or chain native token)
- Paginate pages `1` to `500`, then restart from page `1` continuously
- Exclude transactions where Method/Action is `Transfer`, `Transfer From`, `Approve`, or `Exec`
- Store unique addresses per `chain_id` with duplicate checking
- Append explorer address URLs to `address-url.md` when new addresses are saved
- Run multiple workers in parallel, each with its own Chrome instance and debug port

## Supported chains

Configured in `config.json`:

| Chain ID | Explorer |
|----------|----------|
| 1 | Ethereum (`etherscan.io`) |
| 56 | BSC (`bscscan.com`) |
| 8453 | Base (`basescan.org`) |
| 42161 | Arbitrum (`arbiscan.io`) |

All four chains are enabled in the default worker list. Each worker uses its own Chrome instance and debug port.

## Setup

```bash
cd contract-detect-token-internal-tx-bot
npm install
copy config.example.json config.json
```

Edit `config.json`:

- Set `chrome.executablePath` to your Chrome install path
- Adjust `workers` for parallel runs (each worker needs a unique `debugPort`, starting at `9300`)

## Usage

Run all configured workers in parallel:

```bash
npm start
```

Run selected workers from config:

```bash
node src/index.js --workers eth-internal-eth,bsc-internal-bnb,base-internal-eth,arb-internal-eth
```

Run a single inline worker with CLI overrides:

```bash
node src/index.js --chain-id 1 --txntype 2 --tkn eth --ps 100 --debug-port 9300
node src/index.js --chain-id 56 --txntype 2 --tkn bnb --debug-port 9301
node src/index.js --chain-id 8453 --txntype 2 --tkn eth --debug-port 9302
node src/index.js --chain-id 42161 --txntype 2 --tkn eth --debug-port 9303
```

Run one worker process directly:

```bash
node src/worker.js --chain-id 1 --txntype 2 --tkn eth --debug-port 9300 --worker-id eth-worker
```

## URL format

Workers build URLs like:

```text
https://etherscan.io/advanced-filter?txntype=2&ps=100&tkn=eth&p=1
https://bscscan.com/advanced-filter?txntype=2&ps=100&tkn=bnb&p=1
https://basescan.org/advanced-filter?txntype=2&ps=100&tkn=eth&p=1
https://arbiscan.io/advanced-filter?txntype=2&ps=100&tkn=eth&p=1
```

## Worker debug ports

| Worker | Chain | Debug port |
|--------|-------|------------|
| `eth-internal-eth` | Ethereum | 9300 |
| `bsc-internal-bnb` | BSC | 9301 |
| `base-internal-eth` | Base | 9302 |
| `arb-internal-eth` | Arbitrum | 9303 |

## Address URL file

When a new `from` or `to` address is saved, the bot also appends one explorer URL per line to `address-url.md`:

```text
https://etherscan.io/address/0x48afbbd342f64ef8a9ab1c143719b63c2ad81710
https://bscscan.com/address/0xe9c4d4f095c7943a9ef5ec01afd1385d011855a1
https://basescan.org/address/0x20c0bc331d9cc3d38e1e4b9be8741c6d8f47af90
https://arbiscan.io/address/0x03339ecae41bc162dacae5c2a275c8f64d6c80a0
```

Configure the output path in `config.json`:

```json
"output": {
  "addressUrlFile": "./address-url.md"
}
```

Duplicate URLs are not written again.

## Database

MongoDB (default: `mongodb://127.0.0.1:27017`):

- Database: `contract_detect`
- Collection: `addresses`
- Unique index: `(chain_id, address)`
- Duplicate check runs before insert

## Database status

```bash
npm run db:status
```

Shows total stored addresses, per-chain counts, latest entries, and indexes.

## Empty database

```bash
npm run db:empty -- --yes
```

Deletes all documents from the `addresses` collection. Requires `--yes` to confirm.

Empty one chain only:

```bash
npm run db:empty -- --yes --chain-id 1
```

## Tests

Run direct function tests (uses in-memory MongoDB + Chrome for scraper checks):

```bash
npm test
```

Verify all chains can fetch live transactions from each explorer:

```bash
npm run verify:chains
```

## Notes

- First launch may require manual Cloudflare verification in the opened Chrome window.
- Each worker uses its own Chrome profile under `./chrome-profiles/`.
- Increase `scraper.pageDelayMs` if explorers rate-limit requests.
