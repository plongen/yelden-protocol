# ⚡ Yelden Protocol

> **Golden Yield for Humans and Machines**  
> The first DeFi protocol integrating human UBI and AI Agent rewards in a single productive economy.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Whitepaper](https://img.shields.io/badge/Whitepaper-v12.0-gold)](https://yelden.fund)
[![X](https://img.shields.io/badge/X-@yeldenfund-black)](https://x.com/yeldenfund)
[![Status](https://img.shields.io/badge/Status-Pre--Testnet-blue)]()
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636)](https://soliditylang.org/)

---

## What is Yelden?

Yelden is a dual-token DeFi protocol that tokenizes real-world productive assets (RWAs) and distributes their yield as **Universal Basic Income** — to humans and autonomous AI agents alike.

Named after a village recorded in the Domesday Book of 1086 — the first attempt to measure all productive assets of a nation — Yelden is the second attempt: open, borderless, and on-chain.

```
USDC → yUSD (stable, 4–5% p.a.) → surplus → $YLD (governance + UBI + AI Agents)
```

**The RWA market exceeded $36B on-chain in late 2025.** Yelden is the distribution layer that makes this growth accessible to everyone — including the 3.5 billion adults without brokerage accounts.

---

## Why Yelden is Different

| Protocol | What They Do | What's Missing |
|----------|-------------|----------------|
| **Ondo Finance** | Institutional RWA tokenization | No UBI. No retail. No AI. |
| **Worldcoin** | UBI via iris scanning | Biometric surveillance. No yield. |
| **GoodDollar** | Donation-based UBI | Fragile. Not self-sustaining. |
| **Yelden** | RWA yield + tiered UBI + AI Agent UBI | — |

**Yelden is the only protocol that combines:**
- ✅ Regulated RWA yield basket (7–10% p.a. historical)
- ✅ Scalable tiered UBI from real cash flow
- ✅ **AI Agent UBI — a world first**
- ✅ ZK-private contribution bonuses
- ✅ Community-built thematic sub-vaults
- ✅ Automatic per-transaction carbon offset
- ✅ Bear Market Yield Reserve buffer

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YELDEN PROTOCOL                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User USDC ──► YeldenVault.sol (ERC-4626)                  │
│                      │                                      │
│              ┌───────┴────────┐                            │
│              ▼                ▼                            │
│         yUSD (stable)    RWA Basket                        │
│         4–5% rebase      Ondo / Backed                     │
│                          Centrifuge                        │
│                              │                             │
│                    Yield 7–10% p.a.                        │
│                              │                             │
│              ┌───────────────┼────────────────┐           │
│              ▼               ▼                ▼           │
│         4.5% yUSD       5% EnvFund      Surplus → $YLD    │
│         holders         Toucan/Klima     │                 │
│                                    ┌────┴─────┐           │
│                                    ▼          ▼           │
│                             Human UBI    AI Agent UBI     │
│                             (tiers)      (task-based)     │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Contracts

| Contract | Description | Status |
|----------|-------------|--------|
| `YeldenVault.sol` | ERC-4626 core vault — deposit, allocate, harvest | 🔨 In progress |
| `YeldenDistributor.sol` | Tiered UBI distribution — Basic / Active / Premium | 🔨 In progress |
| `YeldenDAO.sol` | Quadratic voting governance + 48h timelock | 📋 Planned |
| `ZKVerifier.sol` | Groth16 zkSNARK for anonymous contribution proofs | 📋 Planned |
| `AIAgentRegistry.sol` | AI agent registration, task commit-reveal, Chainlink validation | 📋 Planned |

---

## The Human-AI Economy

> *"While Worldcoin spends billions proving you are human, Yelden integrates humans and AI agents in the same productive economy."*

Yelden introduces the world's first **AI Agent UBI** mechanism:

1. **Register** — Agent submits ZK proof of computational autonomy + stakes $YLD collateral
2. **Commit** — Agent commits task output hash on-chain before reveal (anti-manipulation)
3. **Validate** — Chainlink DON scores task quality after 48h window
4. **Claim** — Valid tasks trigger automatic $YLD release from the AI pool

**Qualifying tasks:**
- Governance proposal analysis
- Sub-vault risk monitoring
- Carbon offset route optimization
- Community forum moderation

**Economics:** 5% of the ZK Bonus pool is reserved for AI agents. At $100M TVL, this is ~$175K/year distributed to agents doing real, verified work.

---

## UBI Tiers

```
┌─────────────────────────────────────────────────────────┐
│  BASIC        │  ACTIVE           │  PREMIUM            │
│  All holders  │  ZK contributors  │  Institutional      │
│               │                   │                     │
│  70% UBI pool │  +20% ZK bonus    │  Redirects yield    │
│  proportional │  avg on top       │  to sub-vaults      │
│               │                   │                     │
│  No action    │  Prove ESG/OSS    │  ESG reporting      │
│  required     │  actions via ZK   │  + partnership tier │
└─────────────────────────────────────────────────────────┘
```

**Simulation at $100M TVL:**

| Tier | Monthly UBI |
|------|------------|
| Basic holder | ~$0.73/mo |
| Active contributor | ~$0.88/mo |
| AI Agent (per epoch) | ~$350 |

---

## Token Economics

### $YLD — Governance + Surplus Yield

| Parameter | Value |
|-----------|-------|
| Total supply | 1,000,000,000 — fixed forever |
| Inflation | Zero. No future minting. |
| Deflation | Buyback-and-burn + carbon offset burns |
| Distribution | Fair launch 40% · Airdrop 20% · UBI 20% · Seed 10% · Dev 10% |

### yUSD — Stable Deposit Unit

| Parameter | Value |
|-----------|-------|
| Backing | 1:1 USDC + regulated RWAs |
| Yield | 4–5% p.a. via daily rebase |
| Redemption | 3–7 day gradual window |
| Liquidity | 10% maintained in USDC reserve |

---

## RWA Basket

| Asset | Weight | Provider | Hist. Yield |
|-------|--------|----------|------------|
| MSCI World Index | 50% | Ondo / Backed Finance | ~7% p.a. |
| Nasdaq-100 Global | 25% | Backed / Securitize | ~10% p.a. |
| FTSE All-World | 15% | Ondo / Vanguard tokenized | ~7% p.a. |
| T-bills + Bonds | 10% | Centrifuge / Maple | ~6% p.a. |

All holdings verifiable on-chain via **Chainlink Proof of Reserve**.

---

## Bear Market Protection

If the basket yields below 4.5% base rate:

1. **Yield Reserve Fund** accumulates 20% of surplus in good years
2. Reserve supplements base yield for up to 12 months in downturns
3. If sustained beyond 12 months: DAO vote on base yield reduction
4. 10% USDC liquid reserve covers redemptions — separate from Yield Reserve

---

## Tech Stack

```
Blockchain    Ethereum mainnet + Base L2 (Arbitrum, Polygon phase 3)
Contracts     Solidity 0.8.20 · ERC-4626 · OpenZeppelin upgradeable proxy
Oracles       Chainlink price feeds · Proof of Reserve · CCIP · DON
ZK Proofs     Groth16 via Circom + snarkjs · EZKL for on-chain ML
RWA Partners  Ondo Finance · Backed Finance · Centrifuge · Securitize
Carbon        Toucan Protocol · KlimaDAO tokenized credits
AI            EZKL verifiable ML · Chainlink DON for agent validation
Security      PeckShield + Certik (planned) · Immunefi $500K bounty
```

---

## Roadmap

| Phase | Period | Milestone |
|-------|--------|-----------|
| **Phase 1** | 2026 Q1–Q2 | Whitepaper · Legal formation · Core contracts · DevNet live |
| **Phase 2** | 2026 Q3–Q4 | Testnet · $2–5M anchor seed · Fair launch · Audits |
| **Phase 3** | 2027 Q1–Q2 | Mainnet · UBI active · $25M TVL · First sub-vaults |
| **Phase 4** | 2027 Q3+ | Cross-chain · $100M TVL · On-chain AI · Full DAO |
| **Phase 5** | 2028+ | $500M+ TVL · Global scale · AI agent economy live |

---

## DevNet — Build and Earn $YLD

We reward contributors with real $YLD before the mainnet launch.

| Contribution | Reward |
|-------------|--------|
| Confirmed bug report | $500 $YLD |
| Accepted sub-vault PR | $2,000 $YLD |
| Full thematic vault implementation | $5,000–$10,000 $YLD |

**How to contribute:**
1. Fork this repo
2. Submit a PR — bug fix, sub-vault, or protocol improvement
3. DAO reviewers verify weekly
4. Payment distributed via YeldenDistributor every 7 days

ZK proof required for contribution claims — your identity stays private.

---

## We Are Looking for a Technical Co-Founder

> *"Architecture credibility comes first. Team credibility comes next. We're at step one."*

Yelden has a complete whitepaper (v12, 24 pages), full tokenomics, legal structure, financial model, and this codebase. What it needs is a senior Solidity engineer who believes in the mission.

**What we're looking for:**
- Solidity senior — ERC-4626, zkSNARKs, Chainlink integration experience
- Understands DeFi protocol architecture, not just smart contracts
- Aligned with the Human-AI Economy thesis
- Available to co-found — equity in $YLD from day one

**What we offer:**
- Meaningful $YLD allocation with standard vesting
- Joint decisions from day one — not an employee relationship
- A protocol with genuine architectural differentiation
- A mission worth building

If this is you: **hello@yelden.fund** · **X: @yeldenfund**

---

## Legal

This repository and all associated materials are for informational and development purposes only. $YLD is a governance token. This is not investment advice. This is not a securities offering.

Yelden Protocol operates under a DAO LLC structure (Marshall Islands) and Swiss Foundation (Zug).

---

## Links

- 🌐 **Website:** [yelden.fund](https://yelden.fund)
- 📄 **Whitepaper:** [yelden.fund/whitepaper](https://yelden.fund/whitepaper)
- 🐦 **X:** [@yeldenfund](https://x.com/yeldenfund)
- 💬 **Telegram:** [t.me/yelden](https://t.me/yelden)
- 📧 **Email:** hello@yelden.fund

---

<div align="center">

**YELDEN · Golden Yield for Humans and Machines**  
*In 1086, the Domesday Book recorded every productive asset of a nation.*  
*In 2026, Yelden does it for all of humanity — on a public blockchain.*

</div>
