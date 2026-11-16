# GFGPay — Wallet and payment simulator

Node.js / Express / MongoDB wallet APIs with a browser dashboard. All balances are **demo funds**. Deposits and withdrawals simulate banking operations; this project does not connect to real UPI, banks, SMS payments, or offline settlement.

## Features

- Register/login, password hashing, user-selected transaction PINs, PIN/password changes.
- JWT access and rotating refresh tokens; logout and password changes revoke sessions.
- INR wallet balances, demo deposits, transfers by wallet ID/mobile/user ID, simulated bank withdrawals.
- MongoDB transactions with retries for transient conflicts, balance and daily-spending checks, and unique idempotency keys.
- Retries are bound to the authenticated owner, endpoint and payload. Changed requests cannot reuse a key.
- Browser pending-payment recovery: no PIN is persisted. After a lost response, check the original request status or retry with the same key.
- Filtered and paginated history, recent contacts, activity summaries, bank management, and responsive dashboard.
- Input validation, request limits, escaped/text-only rendering, Helmet headers and environment configuration.

## Run locally

Requires Node.js 20+ for the current test tooling and MongoDB Atlas or a **replica set**. A standalone MongoDB instance cannot run payment transactions.

```sh
npm ci
cp env.example .env
# Set MONGODB_URI and JWT_SECRET in .env
npm start
```

Open http://localhost:5000. Register two users, set each user's PIN in Settings, add demo funds, and make a transfer between them.

For a local MongoDB installation:

```sh
mkdir -p .mongo-data
mongod --dbpath .mongo-data --replSet rs0 --bind_ip 127.0.0.1
# In another terminal:
mongosh --eval 'rs.initiate()'
```

Use `mongodb://localhost:27017/gfgpay?replicaSet=rs0`. Production mode requires a JWT_SECRET of at least 32 characters. Browser crypto APIs require localhost or HTTPS. Demo funding is intentional; do not connect this simulator to real funds.

`npm run seed` resets users, wallets, transactions and bank accounts in the configured database and installs demo accounts. Run only against a disposable development database. Seed accounts include `9876543210` and `9876543211`, password `Test@123`, PIN `1234`. New registrations choose their own PIN.

## Verification

```sh
npm test -- --runInBand
npm run lint
npx playwright install chromium
npm run test:browser
```

For an existing browser executable: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`.

API tests and browser tests each create a disposable MongoDB replica set. The first run downloads a MongoDB binary. No configured production database is used by these tests.

The API suite covers registration/PIN setup, deposits and transfers, replay ownership and payload conflicts, concurrent duplicates, insufficient funds, daily limits/day rollover, invalid amounts, bank ownership and primary selection, history, refresh rotation and session revocation. The Chromium walkthrough covers signup, PIN setup, deposit, transfer, history, analytics, bank management, withdrawal, a committed payment with a lost response and reload, mobile layout, logout/login and PIN/password changes.

## API outline

Base: `/api/v1`. Authenticated calls use `Authorization: Bearer <access-token>`.

| Area | Routes |
| --- | --- |
| Auth | POST `/auth/register`, `/auth/login`, `/auth/login/email`, `/auth/refresh-tokens`, `/auth/logout`; GET `/auth/profile` |
| Credentials | POST `/auth/pin/set`, `/auth/pin/change`, `/auth/password/change` |
| Wallet | GET `/wallet/balance`; POST `/wallet/add-money`, `/wallet/withdraw`, `/wallet/check-balance` |
| Transfers | GET `/transfer/verify`; POST `/transfer/upi`, `/transfer/phone`, `/transfer/user` |
| History | GET `/transactions`, `/transactions/summary`, `/transactions/contacts`, `/transactions/:id`, `/transactions/reference/:reference`, `/transactions/idempotency/:key` |
| Banks | GET/POST `/bank-accounts`; GET/PATCH/DELETE `/bank-accounts/:id`; POST `/bank-accounts/:id/primary` |

Payment POSTs require a UUID v4 `Idempotency-Key` header. Transfers/withdrawals also require a PIN. For example:

```json
{"receiverPhone":"9876543211","amount":25,"pin":"5678","note":"Lunch"}
```

A network error means the outcome is unknown until reconciled. Reuse the same key and unchanged payload for a retry. The UI retains one unresolved payment per user and blocks a new payment until resolved. A PIN is re-entered for a transfer retry. Only a server response with `completed` is shown as confirmed.

## Compatibility

Older transactions without a stored request fingerprint cannot be replayed by the updated middleware. Inspect their existing history/reference instead. Daily spending resets at server-local midnight. The browser stores session tokens in sessionStorage and unresolved payment details without the PIN in localStorage; use a private device and HTTPS for any hosted demo.

The older architecture/learning guides are historical teaching material; use this README and the current source/tests for implemented behavior.
