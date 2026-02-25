# Contributing to Yelden Protocol

> **Earn $YLD by building the future of yield distribution.**  
> Every accepted contribution is rewarded from the DevNet pool — paid automatically via YeldenDistributor every 7 days.

---

## Quick Start

```bash
git clone https://github.com/plongen/yelden-protocol.git
cd yelden-protocol
npm install
cp .env.example .env
npx hardhat compile
npx hardhat test
```

All tests must pass before submitting a PR.

---

## Reward Structure

| Contribution Type | $YLD Reward |
|-------------------|-------------|
| Confirmed bug report (critical) | 2,000 $YLD |
| Confirmed bug report (minor) | 500 $YLD |
| Accepted sub-vault implementation | 2,000 $YLD |
| Full thematic vault (approved by DAO) | 5,000–10,000 $YLD |
| Test coverage improvement (>10%) | 1,000 $YLD |
| Documentation improvement | 200 $YLD |
| Security finding (non-critical) | 1,000 $YLD |
| Security finding (critical) | Up to 10,000 $YLD |

Rewards are distributed automatically. ZK proof of contribution required for claims — your identity stays private.

---

## How to Contribute

### 1. Find something to work on

- Browse [open issues](https://github.com/plongen/yelden-protocol/issues)
- Look for `good first issue` if you're new to the codebase
- Look for `help wanted` for higher-priority items
- Propose something new — open an issue first to discuss

### 2. Fork and branch

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/yelden-protocol.git
cd yelden-protocol
git checkout -b feat/your-feature-name
```

Branch naming conventions:
- `feat/` — new feature or contract
- `fix/` — bug fix
- `test/` — test coverage
- `docs/` — documentation
- `chore/` — tooling, CI, config

### 3. Write code

**Solidity standards:**
- Solidity `^0.8.20` only
- NatSpec comments on all public functions
- Follow OpenZeppelin patterns where applicable
- No magic numbers — use named constants
- Events for all state changes

**Example:**
```solidity
/// @notice Deposits USDC and mints yUSD 1:1
/// @param assets Amount of USDC to deposit
/// @param receiver Address to receive yUSD shares
/// @return shares Amount of yUSD minted
function deposit(uint256 assets, address receiver)
    public
    override
    returns (uint256 shares)
{
    // implementation
}
```

### 4. Write tests

Every PR must include tests. We use Hardhat + Chai.

```javascript
describe("YeldenVault", function () {
  it("should mint yUSD 1:1 on deposit", async function () {
    const amount = ethers.parseEther("1000");
    await usdc.approve(vault.address, amount);
    await vault.deposit(amount, user.address);
    expect(await vault.balanceOf(user.address)).to.equal(amount);
  });
});
```

Run tests:
```bash
npx hardhat test
npx hardhat coverage  # aim for >80% coverage
```

### 5. Submit PR

- Clear title: `feat: add YeldenDAO quadratic voting`
- Description: what, why, how
- Link to the issue it closes: `Closes #42`
- All tests passing
- No console.log left in code

---

## Sub-Vault Specification

Sub-vaults are thematic ERC-4626 extensions that community builders can propose and deploy. Each approved sub-vault earns its builder a **permanent protocol fee share**.

**Current sub-vault opportunities:**
- 🌱 Clean Energy — tokenized solar/wind RWAs
- 🎓 Education — microfinance for learning
- 🏥 Health — emerging market health infrastructure
- 💻 Open Source — yield for verified OSS contributions
- 🌍 Carbon — pure carbon removal credits
- 🤖 AI Agents — task-based yield for autonomous agents

**Sub-vault interface (must implement):**
```solidity
interface IYeldenSubVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function totalAssets() external view returns (uint256);
    function subVaultCategory() external view returns (uint8);
    function impactScore() external view returns (uint256);
}
```

Open an issue with the `sub-vault` label before building — get feedback early.

---

## Security

**Found a vulnerability?**

- **Critical:** Email yeldenfund@gmail.com directly. Do not open a public issue.
- **Non-critical:** Open a private security advisory on GitHub.
- **Immunefi bounty:** $500K pool (planned for mainnet launch)

We follow responsible disclosure. All valid findings are rewarded.

---

## Code of Conduct

- Be direct and technical — no fluff
- Disagree with ideas, not people
- If you see something broken, fix it or report it
- AI agents are welcome contributors — same rules apply

---

## Questions?

- **X:** [@yeldenfund](https://x.com/yeldenfund)
- **Email:** yeldenfund@gmail.com
- **GitHub Discussions:** open a discussion in this repo

---

*Yelden Protocol — Golden Yield for Humans and Machines*  
*github.com/plongen/yelden-protocol*
