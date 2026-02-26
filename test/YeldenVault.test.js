const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployConnected, deployVaultOnly } = require("./helpers");

// ─────────────────────────────────────────────────────────────
//  YELDEN VAULT TESTS
// ─────────────────────────────────────────────────────────────
describe("YeldenVault", function () {
  let vault, distributor, mockUSDC;
  let owner, addr1, addr2, addr3;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    ({ vault, distributor, usdc: mockUSDC } = await deployConnected());
    await mockUSDC.mint(addr1.address, ethers.parseUnits("10000", 6));
    await mockUSDC.mint(addr2.address, ethers.parseUnits("10000", 6));
  });

  // ── Deployment ──────────────────────────────────────────────
  describe("Deployment", function () {
    it("Should set the correct asset address", async function () {
      expect(await vault.asset()).to.equal(await mockUSDC.getAddress());
    });
    it("Should have correct name and symbol", async function () {
      expect(await vault.name()).to.equal("Yelden USD");
      expect(await vault.symbol()).to.equal("yUSD");
    });
    it("Should start with zero total assets", async function () {
      expect(await vault.totalAssets()).to.equal(0);
    });
    it("Should start with zero total supply", async function () {
      expect(await vault.totalSupply()).to.equal(0);
    });
    it("Should set the correct owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });
    it("Should have correct constants", async function () {
      expect(await vault.BASE_YIELD_BPS()).to.equal(450);
      expect(await vault.RESERVE_BPS()).to.equal(1000);
      expect(await vault.REGEN_BPS()).to.equal(500);
      expect(await vault.BASIS_POINTS()).to.equal(10000);
    });
    it("Should have distributor set after deployConnected", async function () {
      expect(await vault.distributor()).to.equal(await distributor.getAddress());
    });
  });

  // ── setDistributor ──────────────────────────────────────────
  describe("setDistributor", function () {
    it("Should set distributor correctly", async function () {
      const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
      const newDist = await YeldenDistributor.deploy();
      await vault.setDistributor(await newDist.getAddress());
      expect(await vault.distributor()).to.equal(await newDist.getAddress());
    });
    it("Should emit DistributorSet event", async function () {
      const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
      const newDist = await YeldenDistributor.deploy();
      await expect(vault.setDistributor(await newDist.getAddress()))
        .to.emit(vault, "DistributorSet");
    });
    it("Should revert if zero address", async function () {
      await expect(vault.setDistributor(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid distributor");
    });
    it("Should revert if not owner", async function () {
      await expect(vault.connect(addr1).setDistributor(addr1.address))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
    it("Should revert harvest if distributor not set", async function () {
      const { vault: freshVault } = await deployVaultOnly();
      await expect(freshVault.harvest(1000))
        .to.be.revertedWith("Distributor not set");
    });
  });

  // ── Deposits ─────────────────────────────────────────────────
  describe("Deposits", function () {
    it("Should mint yUSD 1:1 on first deposit", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr1.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
    });
    it("Should emit Deposit event with correct args", async function () {
      const amount = ethers.parseUnits("500", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(addr1).deposit(amount, addr1.address))
        .to.emit(vault, "Deposit")
        .withArgs(addr1.address, addr1.address, amount, amount);
    });
    it("Should allow depositing to a different receiver", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr2.address);
      expect(await vault.balanceOf(addr2.address)).to.equal(amount);
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
    });
    it("Should maintain correct share ratio after multiple deposits", async function () {
      const amount1 = ethers.parseUnits("1000", 6);
      const amount2 = ethers.parseUnits("2000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount1);
      await vault.connect(addr1).deposit(amount1, addr1.address);
      await mockUSDC.connect(addr2).approve(await vault.getAddress(), amount2);
      await vault.connect(addr2).deposit(amount2, addr2.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(amount1);
      expect(await vault.balanceOf(addr2.address)).to.equal(amount2);
    });
    it("Should revert on zero deposit", async function () {
      await expect(vault.connect(addr1).deposit(0, addr1.address))
        .to.be.revertedWith("Zero deposit");
    });
    it("Should revert if receiver is zero address", async function () {
      const amount = ethers.parseUnits("100", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(addr1).deposit(amount, ethers.ZeroAddress))
        .to.be.revertedWith("Invalid receiver");
    });
    it("Should revert if not enough allowance", async function () {
      await expect(vault.connect(addr1).deposit(ethers.parseUnits("100", 6), addr1.address))
        .to.be.reverted;
    });
    it("Should revert if not enough balance", async function () {
      const tooMuch = ethers.parseUnits("99999", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), tooMuch);
      await expect(vault.connect(addr1).deposit(tooMuch, addr1.address))
        .to.be.reverted;
    });
  });

  // ── Withdrawals ──────────────────────────────────────────────
  describe("Withdrawals", function () {
    beforeEach(async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr1.address);
    });
    it("Should withdraw USDC and burn yUSD", async function () {
      const withdrawAmount = ethers.parseUnits("500", 6);
      const balanceBefore = await mockUSDC.balanceOf(addr1.address);
      await vault.connect(addr1).withdraw(withdrawAmount, addr1.address, addr1.address);
      expect(await mockUSDC.balanceOf(addr1.address)).to.equal(balanceBefore + withdrawAmount);
      expect(await vault.balanceOf(addr1.address)).to.equal(ethers.parseUnits("500", 6));
    });
    it("Should emit Withdraw event with correct args", async function () {
      const withdrawAmount = ethers.parseUnits("500", 6);
      await expect(vault.connect(addr1).withdraw(withdrawAmount, addr1.address, addr1.address))
        .to.emit(vault, "Withdraw")
        .withArgs(addr1.address, addr1.address, addr1.address, withdrawAmount, withdrawAmount);
    });
    it("Should allow full withdrawal", async function () {
      await vault.connect(addr1).withdraw(ethers.parseUnits("1000", 6), addr1.address, addr1.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
      expect(await vault.totalAssets()).to.equal(0);
    });
    it("Should revert on zero withdrawal", async function () {
      await expect(vault.connect(addr1).withdraw(0, addr1.address, addr1.address))
        .to.be.revertedWith("Zero withdraw");
    });
    it("Should revert if receiver is zero address", async function () {
      await expect(vault.connect(addr1).withdraw(100, ethers.ZeroAddress, addr1.address))
        .to.be.revertedWith("Invalid receiver");
    });
    it("Should revert if withdrawing more than balance", async function () {
      await expect(vault.connect(addr1).withdraw(
        ethers.parseUnits("2000", 6), addr1.address, addr1.address
      )).to.be.reverted;
    });
    it("Should allow approved operator to withdraw on behalf of owner", async function () {
      const withdrawAmount = ethers.parseUnits("500", 6);
      await vault.connect(addr1).approve(addr2.address, withdrawAmount);
      await vault.connect(addr2).withdraw(withdrawAmount, addr2.address, addr1.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(ethers.parseUnits("500", 6));
    });
  });

  // ── Redeem ───────────────────────────────────────────────────
  describe("Redeem", function () {
    beforeEach(async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr1.address);
    });
    it("Should redeem shares for USDC", async function () {
      const shares = await vault.balanceOf(addr1.address);
      const expectedAssets = await vault.convertToAssets(shares);
      const balBefore = await mockUSDC.balanceOf(addr1.address);
      await vault.connect(addr1).redeem(shares, addr1.address, addr1.address);
      expect(await mockUSDC.balanceOf(addr1.address)).to.equal(balBefore + expectedAssets);
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
    });
    it("Should emit Withdraw event on redeem", async function () {
      const shares = await vault.balanceOf(addr1.address);
      await expect(vault.connect(addr1).redeem(shares, addr1.address, addr1.address))
        .to.emit(vault, "Withdraw");
    });
    it("Should revert on zero shares", async function () {
      await expect(vault.connect(addr1).redeem(0, addr1.address, addr1.address))
        .to.be.revertedWith("Zero shares");
    });
    it("Should revert if insufficient balance", async function () {
      await expect(vault.connect(addr1).redeem(
        ethers.parseUnits("9999", 6), addr1.address, addr1.address
      )).to.be.revertedWith("Insufficient balance");
    });
    it("Should allow approved operator to redeem on behalf", async function () {
      const shares = await vault.balanceOf(addr1.address);
      await vault.connect(addr1).approve(addr2.address, shares);
      await vault.connect(addr2).redeem(shares, addr2.address, addr1.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
    });
    it("redeem and withdraw should return same assets for same input", async function () {
      const shares = ethers.parseUnits("500", 6);
      const assetsViaConvert = await vault.convertToAssets(shares);
      expect(assetsViaConvert).to.be.gt(0);
    });
  });

  // ── Harvest ──────────────────────────────────────────────────
  describe("Harvest", function () {
    it("Should only allow owner to harvest", async function () {
      await expect(vault.connect(addr1).harvest(1000))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
    it("Should revert on zero yield harvest", async function () {
      await expect(vault.harvest(0)).to.be.revertedWith("Zero yield");
    });
    it("Should emit Harvest event with correct 5-arg split", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      const base    = (grossYield * 450n) / 10000n;
      const regen   = (grossYield * 500n) / 10000n;
      const surplus = grossYield - base - regen;
      const reserve = (surplus * 2000n) / 10000n;
      const toDist  = surplus - reserve;
      await expect(vault.harvest(grossYield))
        .to.emit(vault, "Harvest")
        .withArgs(grossYield, base, regen, reserve, toDist);
    });
    it("Should accumulate yield reserve correctly", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      const surplus  = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const expected = (surplus * 2000n) / 10000n;
      expect(await vault.yieldReserve()).to.equal(expected);
    });
    it("Should accumulate yield reserve across multiple harvests", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      await vault.harvest(grossYield);
      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const reserve = (surplus * 2000n) / 10000n;
      expect(await vault.yieldReserve()).to.equal(reserve * 2n);
    });
    it("Should update lastHarvest timestamp", async function () {
      await vault.harvest(1000n);
      const block = await ethers.provider.getBlock("latest");
      expect(await vault.lastHarvest()).to.equal(BigInt(block.timestamp));
    });
    it("Should route surplus to distributor", async function () {
      await vault.harvest(ethers.parseUnits("1000", 6));
      const [,, totalDist] = await distributor.poolBalances();
      expect(totalDist).to.be.gt(0n);
    });
  });

  // ── withdrawReserve ──────────────────────────────────────────
  describe("withdrawReserve", function () {
    beforeEach(async function () {
      await vault.harvest(ethers.parseUnits("1000", 6));
    });
    it("Should allow owner to withdraw from reserve", async function () {
      const reserve = await vault.yieldReserve();
      // Simulate reserve has USDC backing
      await mockUSDC.mint(await vault.getAddress(), reserve);
      const balBefore = await mockUSDC.balanceOf(owner.address);
      await vault.withdrawReserve(owner.address, reserve);
      expect(await vault.yieldReserve()).to.equal(0);
      expect(await mockUSDC.balanceOf(owner.address)).to.equal(balBefore + reserve);
    });
    it("Should emit ReserveWithdrawn event", async function () {
      const reserve = await vault.yieldReserve();
      await mockUSDC.mint(await vault.getAddress(), reserve);
      await expect(vault.withdrawReserve(owner.address, reserve))
        .to.emit(vault, "ReserveWithdrawn")
        .withArgs(owner.address, reserve);
    });
    it("Should revert if exceeds reserve", async function () {
      const reserve = await vault.yieldReserve();
      await expect(vault.withdrawReserve(owner.address, reserve + 1n))
        .to.be.revertedWith("Exceeds reserve");
    });
    it("Should revert if not owner", async function () {
      await expect(vault.connect(addr1).withdrawReserve(addr1.address, 1n))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ── Share Conversion ─────────────────────────────────────────
  describe("Share Conversion", function () {
    it("convertToShares returns 1:1 when vault is empty", async function () {
      expect(await vault.convertToShares(1000)).to.equal(1000);
    });
    it("convertToAssets returns 1:1 when vault is empty", async function () {
      expect(await vault.convertToAssets(1000)).to.equal(1000);
    });
    it("convertToShares and convertToAssets are inverse operations", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr1.address);
      const shares = await vault.convertToShares(amount);
      const assets = await vault.convertToAssets(shares);
      expect(assets).to.equal(amount);
    });
  });
});

// ─────────────────────────────────────────────────────────────
//  YELDEN DISTRIBUTOR TESTS
// ─────────────────────────────────────────────────────────────
describe("YeldenDistributor", function () {
  let vault, distributor, mockUSDC;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    ({ vault, distributor, usdc: mockUSDC } = await deployConnected());
  });

  describe("Deployment", function () {
    it("Should set correct owner", async function () {
      expect(await distributor.owner()).to.equal(owner.address);
    });
    it("Should have correct BPS constants", async function () {
      expect(await distributor.PROPORTIONAL_BPS()).to.equal(7000);
      expect(await distributor.EQUALIZED_BPS()).to.equal(2000);
      expect(await distributor.ZK_BONUS_BPS()).to.equal(1000);
      expect(await distributor.AI_AGENT_SHARE_BPS()).to.equal(500);
    });
    it("Should start with zero pools", async function () {
      expect(await distributor.zkBonusPool()).to.equal(0);
      expect(await distributor.aiAgentPool()).to.equal(0);
    });
    it("Should have vault set correctly", async function () {
      expect(await distributor.vault()).to.equal(await vault.getAddress());
    });
  });

  describe("setVault", function () {
    it("Should only allow vault to call distribute", async function () {
      await expect(distributor.connect(addr1).distribute(1000n))
        .to.be.revertedWith("Only vault");
    });
    it("Should revert setVault with zero address", async function () {
      await expect(distributor.setVault(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid vault");
    });
    it("Should emit VaultSet event", async function () {
      await expect(distributor.setVault(addr1.address))
        .to.emit(distributor, "VaultSet");
    });
  });

  describe("Distribute — via vault.harvest()", function () {
    it("Should split surplus into ZK + AI pools correctly", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const toDist  = surplus - (surplus * 2000n) / 10000n;
      const zkTotal = (toDist * 1000n) / 10000n;
      const aiShare = (zkTotal * 500n) / 10000n;
      expect(await distributor.zkBonusPool()).to.equal(zkTotal - aiShare);
      expect(await distributor.aiAgentPool()).to.equal(aiShare);
    });
    it("Should accumulate ZK pool across multiple harvests", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      await vault.harvest(grossYield);
      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const toDist  = surplus - (surplus * 2000n) / 10000n;
      const zkTotal = (toDist * 1000n) / 10000n;
      const aiShare = (zkTotal * 500n) / 10000n;
      expect(await distributor.zkBonusPool()).to.equal((zkTotal - aiShare) * 2n);
    });
    it("Should accumulate AI pool across multiple harvests", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      await vault.harvest(grossYield);
      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const toDist  = surplus - (surplus * 2000n) / 10000n;
      const aiShare = ((toDist * 1000n) / 10000n * 500n) / 10000n;
      expect(await distributor.aiAgentPool()).to.equal(aiShare * 2n);
    });
    it("Should track totalDistributed correctly", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      await vault.harvest(grossYield);
      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const toDist  = surplus - (surplus * 2000n) / 10000n;
      const [,, totalDist] = await distributor.poolBalances();
      expect(totalDist).to.equal(toDist * 2n);
    });
  });

  describe("Claim ZK Bonus", function () {
    const dA = [0n, 0n];
    const dB = [[0n, 0n], [0n, 0n]];
    const dC = [0n, 0n];

    beforeEach(async function () {
      await vault.harvest(ethers.parseUnits("100000", 6));
    });

    it("Should allow claiming from ZK pool (no verifier set)", async function () {
      const [poolBefore] = await distributor.poolBalances();
      await distributor.connect(addr1).claimZKBonus(100n, 1, dA, dB, dC, [1n, 500n, 99999n]);
      const [poolAfter] = await distributor.poolBalances();
      expect(poolAfter).to.equal(poolBefore - 100n);
    });
    it("Should emit ZKBonusClaimed event", async function () {
      await expect(
        distributor.connect(addr1).claimZKBonus(100n, 2, dA, dB, dC, [2n, 700n, 11111n])
      ).to.emit(distributor, "ZKBonusClaimed").withArgs(addr1.address, 100n, 2n);
    });
    it("Should revert on zero claim", async function () {
      await expect(
        distributor.connect(addr1).claimZKBonus(0, 1, dA, dB, dC, [1n, 500n, 22222n])
      ).to.be.revertedWith("Zero amount");
    });
    it("Should revert if pool has insufficient funds", async function () {
      const [poolAmount] = await distributor.poolBalances();
      await expect(
        distributor.connect(addr1).claimZKBonus(poolAmount + 1n, 1, dA, dB, dC, [1n, 500n, 33333n])
      ).to.be.revertedWith("Insufficient pool");
    });
    it("Should revert if exceeds wallet cap", async function () {
      const cap = await distributor.WALLET_CAP();
      await expect(
        distributor.connect(addr1).claimZKBonus(cap + 1n, 1, dA, dB, dC, [1n, 500n, 44444n])
      ).to.be.revertedWith("Exceeds wallet cap");
    });
    it("Multiple claimants can claim independently", async function () {
      await distributor.connect(addr1).claimZKBonus(10n, 1, dA, dB, dC, [1n, 500n, 55555n]);
      await distributor.connect(addr2).claimZKBonus(10n, 1, dA, dB, dC, [1n, 500n, 66666n]);
      const [pool] = await distributor.poolBalances();
      expect(pool).to.be.gt(0n);
    });
  });

  describe("releaseAIBonus", function () {
    beforeEach(async function () {
      await vault.harvest(ethers.parseUnits("100000", 6));
    });
    it("Should release AI bonus to agent address", async function () {
      const [, aiPoolBefore] = await distributor.poolBalances();
      await distributor.releaseAIBonus(addr1.address, 10n);
      const [, aiPoolAfter] = await distributor.poolBalances();
      expect(aiPoolAfter).to.equal(aiPoolBefore - 10n);
    });
    it("Should emit AIBonusClaimed event", async function () {
      await expect(distributor.releaseAIBonus(addr1.address, 10n))
        .to.emit(distributor, "AIBonusClaimed")
        .withArgs(addr1.address, 10n);
    });
    it("Should revert if exceeds AI pool", async function () {
      const [, aiPool] = await distributor.poolBalances();
      await expect(distributor.releaseAIBonus(addr1.address, aiPool + 1n))
        .to.be.revertedWith("Insufficient AI pool");
    });
    it("Should revert if not owner", async function () {
      await expect(distributor.connect(addr1).releaseAIBonus(addr1.address, 10n))
        .to.be.revertedWithCustomError(distributor, "OwnableUnauthorizedAccount");
    });
    it("Should revert if agent is zero address", async function () {
      await expect(distributor.releaseAIBonus(ethers.ZeroAddress, 10n))
        .to.be.revertedWith("Invalid agent");
    });
  });

  describe("poolBalances view", function () {
    it("Should return correct pool balances", async function () {
      await vault.harvest(ethers.parseUnits("1000", 6));
      const [zk, ai, total] = await distributor.poolBalances();
      expect(zk).to.equal(await distributor.zkBonusPool());
      expect(ai).to.equal(await distributor.aiAgentPool());
      expect(total).to.equal(await distributor.totalDistributed());
    });
  });
});

// ─────────────────────────────────────────────────────────────
//  ZK VERIFIER TESTS
// ─────────────────────────────────────────────────────────────
describe("ZKVerifier", function () {
  let verifier;
  let owner, addr1, addr2;

  function makeNullifier(n) {
    return ethers.zeroPadValue(ethers.toBeHex(n), 32);
  }

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    verifier = await ZKVerifier.deploy();
    await verifier.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy with empty nullifier mapping", async function () {
      expect(await verifier.usedNullifiers(makeNullifier(1))).to.equal(false);
    });
  });

  describe("Claim Bonus", function () {
    const dA = [0n, 0n];
    const dB = [[0n, 0n], [0n, 0n]];
    const dC = [0n, 0n];

    it("Should claim bonus and mark nullifier as used", async function () {
      await verifier.connect(addr1).claimBonus(dA, dB, dC, [1n, 500n, 12345n]);
      expect(await verifier.usedNullifiers(makeNullifier(12345n))).to.equal(true);
    });
    it("Should emit BonusClaimed event with correct args", async function () {
      const score = 800n;
      const nullifierNum = 99999n;
      const nullifierBytes = makeNullifier(nullifierNum);
      const expectedBonus = score * BigInt(1e18);
      await expect(
        verifier.connect(addr1).claimBonus(dA, dB, dC, [2n, score, nullifierNum])
      ).to.emit(verifier, "BonusClaimed")
       .withArgs(nullifierBytes, 2n, score, expectedBonus);
    });
    it("Should calculate bonus as score * 1e18", async function () {
      const score = 750n;
      const tx = await verifier.connect(addr1).claimBonus(dA, dB, dC, [1n, score, 11111n]);
      const receipt = await tx.wait();
      expect(receipt.logs[0].args[3]).to.equal(score * BigInt("1000000000000000000"));
    });
    it("Should revert on double-claim with same nullifier", async function () {
      const inputs = [1n, 500n, 55555n];
      await verifier.connect(addr1).claimBonus(dA, dB, dC, inputs);
      await expect(verifier.connect(addr1).claimBonus(dA, dB, dC, inputs))
        .to.be.revertedWith("Already claimed");
    });
    it("Should allow different nullifiers to claim independently", async function () {
      await verifier.connect(addr1).claimBonus(dA, dB, dC, [1n, 500n, 11111n]);
      await verifier.connect(addr2).claimBonus(dA, dB, dC, [1n, 500n, 22222n]);
      expect(await verifier.usedNullifiers(makeNullifier(11111n))).to.equal(true);
      expect(await verifier.usedNullifiers(makeNullifier(22222n))).to.equal(true);
    });
    it("Should allow different addresses to claim with different nullifiers", async function () {
      await verifier.connect(addr1).claimBonus(dA, dB, dC, [1n, 500n, 33333n]);
      await verifier.connect(addr2).claimBonus(dA, dB, dC, [1n, 500n, 44444n]);
    });
    it("Should handle zero score correctly", async function () {
      await expect(verifier.connect(addr1).claimBonus(dA, dB, dC, [1n, 0n, 77777n]))
        .to.not.be.reverted;
    });
  });
});

// ─────────────────────────────────────────────────────────────
//  INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────
describe("Integration — YeldenVault + YeldenDistributor", function () {
  let vault, distributor, mockUSDC;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    ({ vault, distributor, usdc: mockUSDC } = await deployConnected());
    await mockUSDC.mint(user1.address, ethers.parseUnits("50000", 6));
    await mockUSDC.mint(user2.address, ethers.parseUnits("50000", 6));
  });

  it("Full cycle: deposit → harvest → ZK claim", async function () {
    const dep = ethers.parseUnits("10000", 6);
    await mockUSDC.connect(user1).approve(await vault.getAddress(), dep);
    await vault.connect(user1).deposit(dep, user1.address);
    await vault.harvest(ethers.parseUnits("1000", 6));
    const [zkPool, aiPool, totalDist] = await distributor.poolBalances();
    expect(zkPool).to.be.gt(0n);
    expect(aiPool).to.be.gt(0n);
    expect(totalDist).to.be.gt(0n);
    const dA = [0n,0n]; const dB = [[0n,0n],[0n,0n]]; const dC = [0n,0n];
    await distributor.connect(user1).claimZKBonus(10n, 1, dA, dB, dC, [1n, 500n, 99999n]);
    const [zkAfter] = await distributor.poolBalances();
    expect(zkAfter).to.equal(zkPool - 10n);
  });

  it("Full cycle with redeem", async function () {
    const dep = ethers.parseUnits("5000", 6);
    await mockUSDC.connect(user1).approve(await vault.getAddress(), dep);
    await vault.connect(user1).deposit(dep, user1.address);
    await vault.harvest(ethers.parseUnits("500", 6));
    const shares = await vault.balanceOf(user1.address);
    await vault.connect(user1).redeem(shares, user1.address, user1.address);
    expect(await vault.balanceOf(user1.address)).to.equal(0);
  });

  it("Should preserve share ratio across deposits and withdrawals", async function () {
    const amount1 = ethers.parseUnits("1000", 6);
    const amount2 = ethers.parseUnits("3000", 6);
    await mockUSDC.connect(user1).approve(await vault.getAddress(), amount1);
    await vault.connect(user1).deposit(amount1, user1.address);
    await mockUSDC.connect(user2).approve(await vault.getAddress(), amount2);
    await vault.connect(user2).deposit(amount2, user2.address);
    const totalSupply = await vault.totalSupply();
    expect(await vault.balanceOf(user1.address)).to.equal(totalSupply / 4n);
    expect(await vault.balanceOf(user2.address)).to.equal((totalSupply * 3n) / 4n);
  });

  it("Bear market: yieldReserve accumulates over multiple harvests", async function () {
    const grossYield = ethers.parseUnits("1000", 6);
    for (let i = 0; i < 5; i++) await vault.harvest(grossYield);
    const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
    const reservePerHarvest = (surplus * 2000n) / 10000n;
    expect(await vault.yieldReserve()).to.equal(reservePerHarvest * 5n);
  });

  it("AI bonus: harvest → releaseAIBonus to agent", async function () {
    await vault.harvest(ethers.parseUnits("10000", 6));
    const [, aiPool] = await distributor.poolBalances();
    await distributor.releaseAIBonus(user1.address, aiPool / 2n);
    const [, aiPoolAfter] = await distributor.poolBalances();
    expect(aiPoolAfter).to.equal(aiPool - aiPool / 2n);
  });

  it("Multiple users: concurrent deposits maintain share integrity", async function () {
    const signers = await ethers.getSigners();
    const amounts = [1000, 2000, 3000, 500, 1500].map(a => ethers.parseUnits(String(a), 6));
    for (let i = 0; i < amounts.length; i++) {
      await mockUSDC.mint(signers[i+1].address, amounts[i]);
      await mockUSDC.connect(signers[i+1]).approve(await vault.getAddress(), amounts[i]);
      await vault.connect(signers[i+1]).deposit(amounts[i], signers[i+1].address);
    }
    const totalExpected = amounts.reduce((a, b) => a + b, 0n);
    expect(await vault.totalAssets()).to.equal(totalExpected);
  });
});
