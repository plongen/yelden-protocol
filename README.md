# Yelden Protocol

> RWA yield distribution with ZK proofs and AI Agent UBI — ERC-4626 vault architecture

[![Tests](https://img.shields.io/badge/tests-127%20passing-brightgreen)](./test)
[![Solidity](https://img.shields.io/badge/solidity-0.8.20-blue)](./contracts)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## Overview

Yelden is a yield distribution protocol built on ERC-4626. Users deposit USDC, receive yUSD shares, and yield harvested from Real World Assets is automatically routed across four channels: base rebase for depositors, environmental regen fund, bear market reserve, and a surplus pool split between human contributors (ZK-proven) and AI agents (Chainlink DON-validated).

---

## Architecture

```
                        ┌─────────────────────────────────┐
                        │         User / dApp              │
                        └────────────┬────────────────────┘
                                     │ deposit(USDC)
                                     ▼
                        ┌─────────────────────────────────┐
                        │         YeldenVault              │
                        │         (ERC-4626)               │
                        │                                  │
                        │  asset: USDC                     │
                        │  shares: yUSD                    │
                        │                                  │
                        │  harvest(grossYield)             │
                        │  ├─ 4.5% → base rebase (yUSD)   │
                        │  ├─ 5.0% → regen fund           │
                        │  ├─ surplus × 20% → yieldReserve│
                        │  └─ surplus × 80% → Distributor │
                        └────────────┬────────────────────┘
                                     │ distribute(surplus)
                                     ▼
                        ┌─────────────────────────────────┐
                        │      YeldenDistributor           │
                        │                                  │
                        │  70% → proportional pool         │
                        │  20% → equalized pool            │
                        │  10% → ZK bonus pool             │
                        │    ├─ 95% → human contributors   │
                        │    └─ 5%  → AI agent pool        │
                        └────────┬────────────┬───────────┘
                                 │            │
                   claimZKBonus()│            │releaseAIBonus()
                                 ▼            ▼
                        ┌──────────────┐ ┌──────────────────┐
                        │ ZKVerifier   │ │ AIAgentRegistry  │
                        │ (Groth16)    │ │ (Chainlink DON)  │
                        │              │ │ [v3 — planned]   │
                        │ nullifier    │ └──────────────────┘
                        │ anti-replay  │
                        └──────────────┘
```

---

## Contracts

### `YeldenVault.sol`
ERC-4626 compliant vault. Accepts USDC, mints yUSD shares 1:1 on first deposit. Exchange rate appreciates as yield is harvested.

| Function | Description |
|---|---|
| `deposit(assets, receiver)` | Deposit USDC, receive yUSD |
| `withdraw(assets, receiver, owner)` | Burn yUSD, receive USDC by asset amount |
| `redeem(shares, receiver, owner)` | Burn yUSD, receive USDC by share amount |
| `harvest(grossYield)` | Owner: distribute RWA yield across protocol |
| `setDistributor(address)` | Owner: connect YeldenDistributor |
| `withdrawReserve(to, amount)` | Owner: release bear market reserve |

**Yield routing** (per `harvest`):
```
grossYield
  ├─ 4.5%  BASE_YIELD_BPS    → rebased into yUSD price
  ├─ 5.0%  REGEN_BPS         → environmental fund
  └─ 90.5% surplus
       ├─ 20%  YIELD_RESERVE  → bear market reserve (yieldReserve)
       └─ 80%  → YeldenDistributor.distribute()
```

---

### `YeldenDistributor.sol`
Receives surplus from vault and allocates to three pools. Only callable by the authorized vault address.

| Function | Description |
|---|---|
| `distribute(surplus)` | Called by vault on each harvest |
| `claimZKBonus(amount, category, proof...)` | Human contributor claims from ZK pool |
| `releaseAIBonus(agent, amount)` | Owner releases from AI pool to agent |
| `setVault(address)` | Owner: authorize vault address |
| `setZKVerifier(address)` | Owner: enable on-chain ZK proof verification |
| `poolBalances()` | View: returns (zkPool, aiPool, totalDistributed) |

**Pool allocation** (per `distribute`):
```
surplus
  ├─ 70%  proportional pool  → pro-rata by $YLD balance [v3]
  ├─ 20%  equalized pool     → flat per-wallet (cap: 500 USDC) [v3]
  └─ 10%  ZK bonus pool
       ├─ 95% → human contributors (ZK proof)
       └─ 5%  → AI agent pool (Chainlink DON) [v3]
```

---

### `ZKVerifier.sol`
Nullifier-based anti-replay registry for ZK bonus claims. Accepts Groth16 proof shape `(a, b, c, publicInputs[3])`. Currently in stub mode — on-chain Groth16 verification integrated in v3.

**publicInputs layout:**
```
[0] category   — contribution type (1=env, 2=oss, 3=community)
[1] score      — contribution score
[2] nullifier  — unique claim identifier (prevents double-spend)
```

---

## Test Suite

```
127 tests passing — 0 failing
```

| Suite | Tests | Coverage |
|---|---|---|
| `YeldenVault.test.js` | 57 | Deployment, deposit, withdraw, redeem, harvest, reserve |
| `YeldenVault.bearmarket.js` | 8 | Reserve accumulation, usage, full cycle simulation |
| `YeldenVault.concurrency.js` | 5 | 10 concurrent users, mixed ops, circular transfers |
| `YeldenVault.fuzz.js` | 9 | 100 random deposits, 50 withdrawals, 100 harvests |
| `YeldenVault.gas.js` | 10 | Gas benchmarks, user journey cost |
| `YeldenVault.mainnet.js` | 11 | Real USDC, Chainlink oracles, Uniswap interop |
| `reentrancy-test.js` | 1 | Reentrancy attack blocked |

**Gas benchmarks** (Hardhat local):
```
deposit (first):   108,179 gas
deposit (second):   74,129 gas
withdraw:           57,311 gas
harvest:           130,993 gas  (includes distributor external call)
transfer:           51,551 gas
full user journey: 223,280 gas  (~$13.40 @ 20 gwei / $3000 ETH)
```

---

## Getting Started

### Prerequisites
```bash
node >= 18
npm >= 9
```

### Install
```bash
git clone https://github.com/YOUR_USERNAME/yelden-protocol
cd yelden-protocol
npm install
```

### Run tests
```bash
# All tests (local)
npx hardhat test

# With mainnet fork (requires Alchemy key)
ALCHEMY_KEY=your_key npx hardhat test

# Single suite
npx hardhat test test/YeldenVault.test.js
```

### Compile
```bash
npx hardhat compile
```

---

## Project Structure

```
yelden-protocol/
├── contracts/
│   ├── YeldenVault.sol          # ERC-4626 vault — core
│   ├── YeldenDistributor.sol    # Yield distribution — 3 pools
│   └── ZKVerifier.sol           # ZK nullifier registry
├── test/
│   ├── helpers.js               # deployConnected(), deployVaultOnly()
│   ├── YeldenVault.test.js      # Main test suite
│   ├── YeldenVault.bearmarket.js
│   ├── YeldenVault.concurrency.js
│   ├── YeldenVault.fuzz.js
│   ├── YeldenVault.gas.js
│   ├── YeldenVault.mainnet.js
│   └── reentrancy-test.js
├── hardhat.config.js
└── package.json
```

---

## Roadmap

### v2 — current
- [x] ERC-4626 vault with `deposit`, `withdraw`, `redeem`
- [x] `harvest()` connected to `YeldenDistributor`
- [x] ZK bonus pool with nullifier anti-replay
- [x] AI agent pool (manual release, owner-controlled)
- [x] Bear market reserve with `withdrawReserve`
- [x] 127 tests passing (fuzz, concurrency, mainnet fork, gas)

### v3 — planned
- [ ] `AIAgentRegistry.sol` — Chainlink DON validation for AI agent UBI
- [ ] Groth16 on-chain verifier — replace ZKVerifier stub
- [ ] `$YLD` token — governance and proportional pool distribution
- [ ] Equalized pool on-chain distribution — `$YLD` holder snapshots
- [ ] RWA adapter interfaces — Ondo, Centrifuge, Maple

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT
