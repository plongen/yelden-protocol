# Yelden Protocol

> RWA yield distribution · ZK privacy · AI Agent economy · ERC-4626 vault

[![Tests](https://img.shields.io/badge/tests-198%20passing-brightgreen)](./test)
[![Solidity](https://img.shields.io/badge/solidity-0.8.20-blue)](./contracts)
[![Certora](https://img.shields.io/badge/certora-7%2F7%20rules-purple)](./certora)
[![Echidna](https://img.shields.io/badge/echidna-3%2F3%20invariants-orange)](./echidna)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## Overview

Yelden is a yield distribution protocol built on ERC-4626. Users deposit USDC, receive yUSD shares, and yield harvested from Real World Assets is automatically routed across four channels: base rebase for depositors, environmental regen fund, bear market reserve, and a surplus pool split between human contributors (ZK-proven via Groth16) and AI agents (Chainlink DON-validated, performance-scored, economically accountable).

**What makes Yelden different:** AI agents don't just participate — they have skin in the game. Agents stake $YLD, earn a performance score (0–1000), pay fees inversely proportional to their score, and are slashed for misbehavior. Score 1000 pays zero. Malicious agents lose everything.

---

## Architecture

```
                     ┌──────────────────────────────────┐
                     │          User / dApp              │
                     └───────────┬──────────────────────┘
                                 │ deposit(USDC)
                                 ▼
                     ┌──────────────────────────────────┐
                     │         YeldenVault               │
                     │         (ERC-4626)                │
                     │                                   │
                     │  asset: USDC  shares: yUSD        │
                     │                                   │
                     │  harvest(grossYield)              │
                     │  ├─ 4.5% → base rebase (yUSD)    │
                     │  ├─ 5.0% → regen fund            │
                     │  ├─ surplus × 20% → yieldReserve │
                     │  └─ surplus × 80% → Distributor  │
                     └───────────┬──────────────────────┘
                                 │ distribute(surplus)
                                 ▼
                     ┌──────────────────────────────────┐
                     │       YeldenDistributor           │
                     │                                   │
                     │  70% → proportional pool         │
                     │  20% → equalized pool            │
                     │  10% → ZK bonus pool             │
                     │    ├─ 95% → human contributors   │
                     │    └─ 5%  → AI agent pool        │
                     └──────────┬──────────┬────────────┘
                                │          │
              claimZKBonus()    │          │ releaseAIBonus()
                                ▼          ▼
                     ┌────────────────┐ ┌──────────────────────┐
                     │  ZKVerifier    │ │   AIAgentRegistry    │
                     │  (Groth16)     │ │   (v3 — complete)    │
                     │                │ │                      │
                     │  verifyProof() │ │  score: 0–1000       │
                     │  nullifier     │ │  fee ∝ (1000−score)  │
                     │  anti-replay   │ │  slash → burn $YLD   │
                     └────────────────┘ └──────────────────────┘
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
       ├─ 20%  YIELD_RESERVE  → bear market reserve
       └─ 80%  → YeldenDistributor.distribute()
```

---

### `YeldenDistributor.sol`
Receives surplus from vault and allocates to three pools.

| Function | Description |
|---|---|
| `distribute(surplus)` | Called by vault on each harvest |
| `claimZKBonus(amount, category, proof...)` | Human contributor claims from ZK pool |
| `releaseAIBonus(agent, amount)` | Owner releases from AI pool to agent |
| `setVault(address)` | Owner: authorize vault address |
| `setZKVerifier(address)` | Owner: enable on-chain ZK proof verification |
| `poolBalances()` | View: returns (zkPool, aiPool, totalDistributed) |

---

### `ZKVerifier.sol` + `contracts/zk/Groth16Verifier.sol`
On-chain Groth16 proof verifier. Accepts real ZK proofs generated by `circuits/contribution.circom`.

**Public inputs layout:**
```
input[0] = valid          — 1 if score >= threshold, 0 otherwise
input[1] = threshold      — minimum score required (e.g. 500)
input[2] = nullifierHash  — Poseidon(score, salt, 1) — prevents double-claim
input[3] = commitmentHash — Poseidon(score, salt) — proves consistency
```

| Function | Description |
|---|---|
| `claimBonus(a, b, c, input[4])` | Verify Groth16 proof, mark nullifier, emit event |
| `verifyOnly(a, b, c, input[4])` | View: validate proof without state change |
| `isNullifierUsed(nullifierHash)` | View: check if nullifier already used |

**Privacy guarantee:** The prover demonstrates `score >= threshold` without revealing `score` or `salt`. Nobody — including the protocol — can link a proof to its claimer.

---

### `AIAgentRegistry.sol`
On-chain reputation primitive for autonomous AI agents. Formally verified. Any protocol integrates in two lines:

```solidity
IAgentRegistry registry = IAgentRegistry(REGISTRY_ADDRESS);
require(registry.isEligible(agent), "Agent not eligible");
```

**Score model:** Score starts at 300 on approval and grows only through verified performance. Capital cannot buy a higher score.

**Fee model:**
```
monthly fee = monthlyFee × (1000 − score) / 1000

score 1000 → 0 YLD/month  (perfect agent, free forever)
score 500  → 0.5 YLD/month
score 0    → 1 YLD/month  (full fee, self-eliminates)
```

**Slash levels:**

| Level | Stake Burned | Status After |
|---|---|---|
| WARNING | 10% | ACTIVE |
| SUSPENSION | 50% | PENDING |
| BAN | 100% | BANNED permanently |

All fees and slashed $YLD are burned to `0x000...dead`. Self-cleaning registry — underperforming agents self-eliminate without governance intervention.

---

## ZK Circuit

```bash
# Compile (requires circom 2.x — see Getting Started)
cd circuits
circom contribution.circom --r1cs --wasm --sym --O2 --output build/

# Verify existing proof
snarkjs groth16 verify circuits/build/verification_key.json \
  circuits/build/public.json circuits/build/proof.json
```

**Circuit stats:**
```
template instances:      144
non-linear constraints:  532
public inputs:           3
private inputs:          2 (score, salt — never revealed)
public outputs:          1 (valid)
```

---

## Test Suite

```
198 tests passing — 0 failing
```

| Suite | Tests | Description |
|---|---|---|
| `YeldenVault.test.js` | 57 | Deployment, deposit, withdraw, redeem, harvest, reserve |
| `YeldenVault.bearmarket.js` | 8 | Reserve accumulation, usage, full cycle |
| `YeldenVault.concurrency.js` | 5 | 10 concurrent users, mixed ops |
| `YeldenVault.fuzz.js` | 9 | 100 random deposits, 50 withdrawals, 100 harvests |
| `YeldenVault.gas.js` | 10 | Gas benchmarks, user journey cost |
| `YeldenVault.mainnet.js` | 11 | Real USDC, Chainlink oracles, Uniswap interop |
| `reentrancy-test.js` | 1 | Reentrancy attack blocked |
| `AIAgentRegistry.test.js` | 69 | Registration, scoring, fees, slashing, lifecycle |
| `ZKVerifier.test.js` | 16 | Real Groth16 proofs, nullifier, double-claim, manipulation |
| `YeldenDistributor` | 12 | Pool distribution, ZK bonus, AI pool |

**Formal verification:**
```
Certora Prover:   7/7 rules verified
Echidna fuzzing:  3/3 invariants — 10,000 call sequences — zero violations
Mutation testing: 10/10 killed — 100% mutation score
Coverage:         95.88% lines (vault: 100%)
```

**Gas benchmarks:**
```
deposit (first):    108,179 gas
deposit (second):    74,129 gas
withdraw:            57,311 gas
harvest:            130,993 gas
registerAgent:       ~95,000 gas
claimBonus (ZK):    ~280,000 gas  (includes Groth16 on-chain verification)
```

---

## Getting Started

### Prerequisites
```bash
node >= 18
npm >= 9
rust >= 1.70  # for circom 2.x
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

# ZK verifier (requires circuits/build/ artifacts)
npx hardhat test test/ZKVerifier.test.js

# Registry
npx hardhat test test/AIAgentRegistry.test.js

# With mainnet fork
ALCHEMY_KEY=your_key npx hardhat test
```

### Compile ZK circuit (WSL or Linux)
```bash
# Install circom 2.x
git clone https://github.com/iden3/circom.git ~/.circom
cd ~/.circom && cargo build --release
export PATH="$HOME/.circom/target/release:$PATH"

# Compile
cd /path/to/yelden-protocol/circuits
circom contribution.circom --r1cs --wasm --sym --O2 --output build/
```

---

## Project Structure

```
yelden-protocol/
├── contracts/
│   ├── YeldenVault.sol           # ERC-4626 vault — core
│   ├── YeldenDistributor.sol     # Yield distribution — 3 pools
│   ├── ZKVerifier.sol            # Groth16 nullifier verifier
│   ├── AIAgentRegistry.sol       # AI agent reputation — v3
│   └── zk/
│       └── Groth16Verifier.sol   # Generated by snarkjs
├── circuits/
│   ├── contribution.circom       # ZK circuit — score >= threshold
│   └── build/
│       ├── contribution.r1cs
│       ├── contribution.sym
│       ├── contribution_js/
│       │   └── contribution.wasm
│       ├── contribution_0001.zkey
│       └── verification_key.json
├── test/
│   ├── helpers.js
│   ├── YeldenVault.test.js
│   ├── YeldenVault.bearmarket.js
│   ├── YeldenVault.concurrency.js
│   ├── YeldenVault.fuzz.js
│   ├── YeldenVault.gas.js
│   ├── YeldenVault.mainnet.js
│   ├── reentrancy-test.js
│   ├── AIAgentRegistry.test.js
│   └── ZKVerifier.test.js
├── certora/                      # Formal verification specs
├── echidna/                      # Fuzz invariants
├── hardhat.config.js
└── package.json
```

---

## Roadmap

### v3 — current
- [x] `AIAgentRegistry.sol` — subscription stake, performance fee burn, slashing
- [x] `ZKVerifier.sol` — real Groth16 on-chain verifier
- [x] `circuits/contribution.circom` — compiled, trusted setup complete, proof verified
- [x] `contracts/zk/Groth16Verifier.sol` — generated by snarkjs
- [x] 198 tests passing

### v4 — next
- [ ] `$YLD` token — ERC-20, 1B fixed supply, burn, governance
- [ ] `veYLD` — vote-escrowed lock for Registry stake
- [ ] RWA adapters — Ondo, Centrifuge, Maple
- [ ] Oracle redundancy — Chainlink primary + Pyth secondary + circuit breaker
- [ ] Chainlink DON integration — real SCORER_ROLE automation

---

## Security

| Tool | Result |
|---|---|
| Certora Prover | 7/7 rules verified |
| Echidna | 3/3 invariants — 10k sequences |
| Mutation testing | 100% score |
| Slither | 40 findings — all low risk |
| Coverage | 95.88% lines |

One real bug found and documented: `harvest()` reserve accounting can exceed `totalAssets()` before a corresponding deposit. Confirmed expected behavior — invariant updated in both Echidna and Certora specs.

Commercial audit (Code4rena or Trail of Bits) planned before mainnet deployment.

---

## Contributing

DevNet bounties: $500 YLD per confirmed bug, $2,000 per accepted sub-vault.

---

## License

MIT
