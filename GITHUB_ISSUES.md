# GitHub Issues para criar no repositório Yelden Protocol

Crie cada uma manualmente em:
https://github.com/plongen/yelden-protocol/issues/new

---

## 🟢 good first issue — Para novos contribuidores

### Issue 1
**Título:** Add NatSpec documentation to YeldenVault.sol
**Labels:** documentation, good first issue
**Descrição:**
All public and external functions in `YeldenVault.sol` need complete NatSpec comments.
Required for every function: `@notice`, `@param`, `@return`.
See [Solidity NatSpec docs](https://docs.soliditylang.org/en/latest/natspec-format.html).
**Reward:** 200 $YLD

---

### Issue 2
**Título:** Write unit tests for YeldenDistributor.sol — basic tier distribution
**Labels:** testing, good first issue
**Descrição:**
`YeldenDistributor.sol` needs unit tests covering:
- [ ] `distribute()` splits correctly between tiers
- [ ] Basic tier proportional distribution by $YLD balance
- [ ] Anti-whale cap respected (walletCap = 500e18)
- [ ] Event emission verified
**Reward:** 1,000 $YLD

---

### Issue 3
**Título:** Add .solhint.json configuration
**Labels:** tooling, good first issue
**Descrição:**
Add a `.solhint.json` file to enforce consistent Solidity style across the codebase.
Recommended rules: `avoid-low-level-calls`, `no-console`, `func-visibility`, `state-visibility`.
**Reward:** 200 $YLD

---

## 🟡 help wanted — Contribuições prioritárias

### Issue 4
**Título:** Implement YeldenDAO.sol — quadratic voting governance
**Labels:** enhancement, help wanted, contracts
**Descrição:**
Design and implement `YeldenDAO.sol` with:
- [ ] Quadratic voting (votes = sqrt(YLD balance))
- [ ] 48-hour timelock between approval and execution
- [ ] Proposal lifecycle: pending → active → queued → executed / defeated
- [ ] Quorum: 5% of circulating supply
- [ ] Sub-vault approval pipeline
Reference: OpenZeppelin Governor + TimelockController
**Reward:** 5,000–10,000 $YLD

---

### Issue 5
**Título:** Implement ZK contribution proof circuit (Circom)
**Labels:** enhancement, help wanted, zk-proofs
**Descrição:**
Build the Groth16 Circom circuit for human contributor ZK proofs.
Public inputs: `[category, score, nullifier, merkleRoot]`
The circuit must prove: "I performed action of category X with score Y" without revealing identity.
Tools: Circom 2.0 + snarkjs + EZKL
**Reward:** 10,000 $YLD

---

### Issue 6
**Título:** Integrate Ondo Finance OUSG as first RWA provider
**Labels:** enhancement, help wanted, rwa-integration
**Descrição:**
Add the first real RWA adapter to `YeldenVault.sol`:
- [ ] Implement `IRWAProvider` interface for Ondo OUSG
- [ ] `deposit()` allocates to OUSG via Ondo contracts
- [ ] `harvest()` collects yield from OUSG
- [ ] Mock for local testing
Ondo docs: https://docs.ondo.finance
**Reward:** 5,000 $YLD

---

### Issue 7
**Título:** Add Chainlink Proof of Reserve verification to YeldenVault
**Labels:** enhancement, help wanted, oracles
**Descrição:**
Integrate Chainlink PoR to verify RWA backing on-chain:
- [ ] Fetch PoR feed for each RWA provider
- [ ] Add `verifyReserves()` function
- [ ] Emit `ReservesVerified` event with timestamp
- [ ] Fail gracefully if PoR is stale (> 24h)
Chainlink PoR docs: https://docs.chain.link/data-feeds/proof-of-reserve
**Reward:** 3,000 $YLD

---

### Issue 8
**Título:** Implement AIAgentRegistry.sol — task commit-reveal + Chainlink DON
**Labels:** enhancement, help wanted, ai-agents
**Descrição:**
Core contract for AI Agent UBI (world first).
- [ ] `registerAgent()` with ZK proof + 100 $YLD collateral stake
- [ ] `commitTask()` — hash committed before reveal window
- [ ] `fulfillValidation()` — Chainlink DON scores 0–1000
- [ ] `claimReward()` — proportional to quality score
- [ ] Slash logic for score < 300
See whitepaper Section 09 for full spec.
**Reward:** 8,000 $YLD

---

### Issue 9
**Título:** Build Clean Energy sub-vault — tokenized solar/wind RWAs
**Labels:** sub-vault, help wanted, enhancement
**Descrição:**
First community sub-vault implementation.
Must implement `IYeldenSubVault` interface (see CONTRIBUTING.md).
- [ ] Accepts USDC, allocates to solar/wind tokenized RWAs
- [ ] Higher ESG impact score than base vault
- [ ] `impactScore()` returns verified carbon offset per dollar
- [ ] Full test suite
**Reward:** 5,000 $YLD + permanent protocol fee share

---

### Issue 10
**Título:** Add gas optimization report to CI pipeline
**Labels:** tooling, help wanted, optimization
**Descrição:**
Add `hardhat-gas-reporter` to the test suite and CI pipeline.
- [ ] Install and configure `hardhat-gas-reporter`
- [ ] Add gas report to CI output
- [ ] Set gas limits as PR checks (fail if function exceeds limit)
- [ ] Document gas benchmarks in README
**Reward:** 500 $YLD

---

## 🔴 Sugestão de Topics para adicionar no repositório

Vá em: github.com/plongen/yelden-protocol → engrenagem ao lado de "About" → Topics

Adicione:
defi
rwa
solidity
erc4626
zk-proofs
ubi
universal-basic-income
ai-agents
ethereum
hardhat
chainlink
real-world-assets
yield-protocol
dao
