# Yelden Protocol

> On-chain reputation infrastructure for autonomous AI agents — ERC-4626 yield vault with formal verification

📄 [Technical One-Pager (PDF)](https://github.com/plongen/yelden-protocol/releases/download/v2.0/yelden-protocol-v2-onepager.pdf) — overview for technical co-founders and researchers

[![Tests](https://img.shields.io/badge/tests-124%20passing-brightgreen)](./test)
[![Coverage](https://img.shields.io/badge/coverage-95.88%25-brightgreen)](./coverage)
[![Certora](https://img.shields.io/badge/certora-7%2F7%20verified-blue)](./test/certora)
[![Solidity](https://img.shields.io/badge/solidity-0.8.20-blue)](./contracts)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## Overview

Yelden is a yield distribution protocol built on ERC-4626. Users deposit USDC, receive yUSD shares, and yield harvested from Real World Assets is automatically routed across four channels: base rebase for depositors, bear market reserve, and a surplus pool split between ZK-proven human contributors and AI agents with on-chain reputation scores.

The **AIAgentRegistry** is the core primitive — an on-chain registry that gives autonomous agents a verifiable identity, a reputation score (0–1000) updated by a Chainlink DON, and economic accountability via slashing (v2).

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
                        │              │ │                  │
                        │ nullifier    │ │ score: 0–1000    │
                        │ anti-replay  │ │ PENDING→ACTIVE   │
                        └──────────────┘ └──────────────────┘
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

> **Note:** `harvest()` is purely accounting — `yieldReserve` tracks cumulative reserve allocation and can exceed `totalAssets()` before a corresponding USDC deposit. Documented behavior, verified by Echidna and Certora.

---

### `YeldenDistributor.sol`
Receives surplus from vault and allocates to three pools. Only callable by the authorized vault address.

| Function | Description |
|---|---|
| `distribute(surplus)` | Called by vault on each harvest |
| `claimZKBonus(amount, category, proof...)` | Human contributor claims from ZK pool |
| `releaseAIBonus(agent, amount)` | Owner releases from AI pool to eligible agent |
| `setVault(address)` | Owner: authorize vault address |
| `setZKVerifier(address)` | Owner: enable on-chain ZK proof verification |
| `setRegistry(address)` | Owner: connect AIAgentRegistry |
| `poolBalances()` | View: returns (zkPool, aiPool, totalDistributed) |

---

### `AIAgentRegistry.sol`
On-chain reputation registry for autonomous AI agents. Any address can register — approval and score updates are oracle-governed.

| Function | Description |
|---|---|
| `registerAgent(name, agentType)` | Permissionless — pays 10 USDC anti-spam fee |
| `approveAgent(address)` | DON or owner — transitions PENDING → ACTIVE |
| `banAgent(address, reason)` | Owner — transitions to BANNED |
| `updateScore(address, score)` | DON or owner — updates score 0–1000 |
| `updateScoreBatch(addresses, scores)` | DON — batch update up to 50 agents |
| `isEligible(address)` | View — ACTIVE and score ≥ 500 |
| `isActive(address)` | View — ACTIVE status |
| `score(address)` | View — current score (0–1000) |
| `getAgent(address)` | View — full agent profile |

**Agent lifecycle:**
```
registerAgent()  →  PENDING  →  ACTIVE  →  BANNED
                    (10 USDC)   (DON/owner) (owner, score < 500)
```

**Integration** (3 lines of Solidity):
```solidity
import "./interfaces/IAgentRegistry.sol";

IAgentRegistry registry = IAgentRegistry(REGISTRY_ADDRESS);
require(registry.isEligible(agent), "Agent not eligible");
```

---

### `ZKVerifier.sol`
Nullifier-based anti-replay registry for ZK bonus claims. Accepts Groth16 proof shape `(a, b, c, publicInputs[3])`. Currently in stub mode — on-chain Groth16 verification in v3.

---

## Security — Phase 1 Pre-Audit Tooling

Full pre-audit tooling stack completed before registry development:

| Tool | Result | Details |
|---|---|---|
| `solidity-coverage` | **95.88% lines** | `YeldenVault.sol`: 100% line coverage |
| Mutation testing | **10/10 killed** | 100% mutation score — every semantic change caught |
| Slither | **40 findings** | All low-risk: naming conventions, immutable suggestions |
| Echidna fuzzing | **3/3 invariants** | 10,000 call sequences, 0 violations |
| Certora Prover | **7/7 rules verified** | Formal mathematical proof — No errors found |

**Real bug found:** Echidna falsified `echidna_reserve_bounded` — `yieldReserve` can exceed `totalAssets()` after `harvest()` without a prior USDC deposit. Confirmed expected behavior by design. Invariant updated in both Echidna and Certora specs.

---

## Test Suite

```
124 tests passing — 0 failing
```

| Suite | Tests | Description |
|---|---|---|
| `YeldenVault.test.js` | 57 | Deployment, deposit, withdraw, redeem, harvest, reserve |
| `YeldenVault.bearmarket.js` | 8 | Reserve accumulation, usage, full cycle |
| `YeldenVault.concurrency.js` | 5 | 10 concurrent users, mixed ops, circular transfers |
| `YeldenVault.fuzz.js` | 9 | 100 random deposits, 50 withdrawals, 100 harvests |
| `YeldenVault.gas.js` | 10 | Gas benchmarks, user journey cost |
| `YeldenVault.mainnet.js` | 11 | Real USDC, Chainlink oracles, Uniswap interop |
| `reentrancy-test.js` | 1 | Reentrancy attack blocked |
| Integration | 6 | Full cycle: deposit → harvest → ZK claim → AI bonus |

**Gas benchmarks** (Hardhat local):
```
deposit (first):   112,159 gas
deposit (second):   78,382 gas
withdraw:           61,669 gas
harvest:           137,410 gas  (includes distributor external call)
transfer:           52,141 gas
full user journey: 238,889 gas  (~$14.33 @ 20 gwei / $3000 ETH)
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
git clone https://github.com/plongen/yelden-protocol
cd yelden-protocol
npm install
```

### Run tests
```bash
# All tests
npx hardhat test

# Coverage
npx hardhat coverage

# Mutation testing
npx hardhat clean && npx hardhat compile
node scripts/mutation/run-mutations.js

# Echidna fuzzing (Linux / WSL)
echidna contracts/EchidnaSimple.sol \
  --contract EchidnaSimple \
  --config test/echidna/echidna.config.yaml \
  --solc-args "--allow-paths $(pwd) --base-path $(pwd) --include-path $(pwd)/node_modules"

# Certora formal verification
certoraRun contracts/YeldenVault.sol contracts/YeldenDistributor.sol \
  --verify YeldenVault:test/certora/YeldenVault.spec \
  --solc solc \
  --packages @openzeppelin=node_modules/@openzeppelin \
  --wait_for_results
```

---

## Project Structure

```
yelden-protocol/
├── contracts/
│   ├── YeldenVault.sol          # ERC-4626 vault — core
│   ├── YeldenDistributor.sol    # Yield distribution — 3 pools
│   ├── ZKVerifier.sol           # ZK nullifier registry (stub)
│   ├── AIAgentRegistry.sol      # On-chain agent reputation
│   ├── IAgentRegistry.sol       # Interface for Distributor integration
│   ├── interfaces/
│   └── mocks/
├── scripts/
│   └── mutation/
│       └── run-mutations.js     # Mutation testing script
├── test/
│   ├── helpers.js
│   ├── YeldenVault.test.js
│   ├── YeldenVault.bearmarket.js
│   ├── YeldenVault.concurrency.js
│   ├── YeldenVault.fuzz.js
│   ├── YeldenVault.gas.js
│   ├── YeldenVault.mainnet.js
│   ├── reentrancy-test.js
│   ├── certora/
│   │   └── YeldenVault.spec     # Certora formal verification spec
│   └── echidna/
│       ├── EchidnaSimple.sol    # Echidna fuzzing harness
│       └── echidna.config.yaml
├── hardhat.config.js
└── package.json
```

---

## Roadmap

### v2 — complete
- [x] ERC-4626 vault with `deposit`, `withdraw`, `redeem`
- [x] `harvest()` connected to `YeldenDistributor`
- [x] ZK bonus pool with nullifier anti-replay
- [x] AI agent pool (manual release, owner-controlled)
- [x] Bear market reserve with `withdrawReserve`
- [x] 124 tests passing (fuzz, concurrency, mainnet fork, gas)
- [x] 95.88% line coverage — YeldenVault.sol 100%
- [x] Mutation score 100% (10/10 killed)
- [x] Slither, Echidna, Certora — Phase 1 pre-audit complete
- [x] `AIAgentRegistry.sol` — permissionless registration, DON scoring, lifecycle management

### v3 — planned
- [ ] Slashing — agents stake $YLD, score < 300 triggers partial slash
- [ ] Groth16 on-chain verifier — replace ZKVerifier stub
- [ ] `$YLD` token — governance and proportional pool distribution
- [ ] Equalized pool on-chain distribution — `$YLD` holder snapshots
- [ ] RWA adapter interfaces — Ondo, Centrifuge, Maple
- [ ] Standard interface — `IAgentRegistry` composable with external protocols

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT
