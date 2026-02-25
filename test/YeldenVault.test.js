const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─────────────────────────────────────────────────────────────
//  YELDEN VAULT TESTS
// ─────────────────────────────────────────────────────────────
describe("YeldenVault", function () {
  let vault, mockUSDC;
  let owner, addr1, addr2, addr3;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();

    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(
      await mockUSDC.getAddress(),
      "Yelden USD",
      "yUSD"
    );
    await vault.waitForDeployment();

    // Fund addr1 and addr2 with USDC
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
  });

  // ── Deposit ─────────────────────────────────────────────────
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
      expect(await vault.totalAssets()).to.equal(amount1 + amount2);
    });

    it("Should revert on zero deposit", async function () {
      await expect(
        vault.connect(addr1).deposit(0, addr1.address)
      ).to.be.revertedWith("Zero deposit");
    });

    it("Should revert if receiver is zero address", async function () {
      const amount = ethers.parseUnits("100", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await expect(
        vault.connect(addr1).deposit(amount, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid receiver");
    });

    it("Should revert if not enough allowance", async function () {
      const amount = ethers.parseUnits("100", 6);
      // No approval given
      await expect(
        vault.connect(addr1).deposit(amount, addr1.address)
      ).to.be.reverted;
    });

    it("Should revert if not enough balance", async function () {
      const tooMuch = ethers.parseUnits("99999", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), tooMuch);
      await expect(
        vault.connect(addr1).deposit(tooMuch, addr1.address)
      ).to.be.reverted;
    });
  });

  // ── Withdraw ────────────────────────────────────────────────
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

      expect(await mockUSDC.balanceOf(addr1.address)).to.equal(
        balanceBefore + withdrawAmount
      );
      expect(await vault.balanceOf(addr1.address)).to.equal(
        ethers.parseUnits("500", 6)
      );
    });

    it("Should emit Withdraw event with correct args", async function () {
      const withdrawAmount = ethers.parseUnits("500", 6);
      await expect(
        vault.connect(addr1).withdraw(withdrawAmount, addr1.address, addr1.address)
      )
        .to.emit(vault, "Withdraw")
        .withArgs(
          addr1.address,
          addr1.address,
          addr1.address,
          withdrawAmount,
          withdrawAmount
        );
    });

    it("Should allow full withdrawal", async function () {
      const fullAmount = ethers.parseUnits("1000", 6);
      await vault.connect(addr1).withdraw(fullAmount, addr1.address, addr1.address);

      expect(await vault.balanceOf(addr1.address)).to.equal(0);
      expect(await vault.totalAssets()).to.equal(0);
    });

    it("Should revert on zero withdrawal", async function () {
      await expect(
        vault.connect(addr1).withdraw(0, addr1.address, addr1.address)
      ).to.be.revertedWith("Zero withdraw");
    });

    it("Should revert if receiver is zero address", async function () {
      await expect(
        vault.connect(addr1).withdraw(100, ethers.ZeroAddress, addr1.address)
      ).to.be.revertedWith("Invalid receiver");
    });

    it("Should revert if withdrawing more than balance", async function () {
      const tooMuch = ethers.parseUnits("2000", 6);
      await expect(
        vault.connect(addr1).withdraw(tooMuch, addr1.address, addr1.address)
      ).to.be.reverted;
    });

    it("Should allow approved operator to withdraw on behalf of owner", async function () {
      const withdrawAmount = ethers.parseUnits("500", 6);
      // addr1 approves addr2 to spend shares
      await vault.connect(addr1).approve(addr2.address, withdrawAmount);

      await vault.connect(addr2).withdraw(withdrawAmount, addr2.address, addr1.address);

      expect(await vault.balanceOf(addr1.address)).to.equal(
        ethers.parseUnits("500", 6)
      );
    });
  });

  // ── Harvest ─────────────────────────────────────────────────
  describe("Harvest", function () {
    it("Should only allow owner to harvest", async function () {
      await expect(
        vault.connect(addr1).harvest(1000)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should revert on zero yield harvest", async function () {
      await expect(vault.harvest(0)).to.be.revertedWith("Zero yield");
    });

    it("Should emit Harvest event with correct split", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      const base = (grossYield * 450n) / 10000n;    // 4.5%
      const regen = (grossYield * 500n) / 10000n;   // 5%
      const surplus = grossYield - base - regen;
      const reserve = (surplus * 2000n) / 10000n;    // 20%
      const finalSurplus = surplus - reserve;

      await expect(vault.harvest(grossYield))
        .to.emit(vault, "Harvest")
        .withArgs(grossYield, base, regen, finalSurplus);
    });

    it("Should accumulate yield reserve correctly", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);

      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const expectedReserve = (surplus * 2000n) / 10000n;

      expect(await vault.yieldReserve()).to.equal(expectedReserve);
    });

    it("Should accumulate yield reserve across multiple harvests", async function () {
      const grossYield = ethers.parseUnits("1000", 6);
      await vault.harvest(grossYield);
      await vault.harvest(grossYield);

      const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
      const reservePerHarvest = (surplus * 2000n) / 10000n;

      expect(await vault.yieldReserve()).to.equal(reservePerHarvest * 2n);
    });
  });

  // ── Share Conversion ────────────────────────────────────────
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
  let distributor;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
    distributor = await YeldenDistributor.deploy();
    await distributor.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────
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
  });

  // ── Distribute ──────────────────────────────────────────────
  describe("Distribute", function () {
    it("Should only allow owner to distribute", async function () {
      await expect(
        distributor.connect(addr1).distribute(1000)
      ).to.be.revertedWithCustomError(distributor, "OwnableUnauthorizedAccount");
    });

    it("Should split surplus correctly — 70/20/10", async function () {
      const surplus = 10000n;
      await distributor.distribute(surplus);

      const zkPool = (surplus * 1000n) / 10000n;          // 10%
      const aiShare = (zkPool * 500n) / 10000n;           // 5% of ZK pool
      const expectedZK = zkPool - aiShare;
      const expectedAI = aiShare;

      expect(await distributor.zkBonusPool()).to.equal(expectedZK);
      expect(await distributor.aiAgentPool()).to.equal(expectedAI);
    });

    it("Should emit Distributed event with correct args", async function () {
      const surplus = 10000n;
      const proportional = (surplus * 7000n) / 10000n;
      const equalized = (surplus * 2000n) / 10000n;
      const zkPool = (surplus * 1000n) / 10000n;

      const tx = await distributor.distribute(surplus);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const event = receipt.logs[0];

      expect(event.args[0]).to.equal(proportional);
      expect(event.args[1]).to.equal(equalized);
      expect(event.args[2]).to.equal(zkPool);
      expect(event.args[3]).to.equal(BigInt(block.timestamp));
    });

    it("Should accumulate ZK pool across multiple distributions", async function () {
      const surplus = 10000n;
      await distributor.distribute(surplus);
      await distributor.distribute(surplus);

      const zkPool = (surplus * 1000n) / 10000n;
      const aiShare = (zkPool * 500n) / 10000n;
      const expectedZK = (zkPool - aiShare) * 2n;

      expect(await distributor.zkBonusPool()).to.equal(expectedZK);
    });

    it("Should accumulate AI agent pool across multiple distributions", async function () {
      const surplus = 10000n;
      await distributor.distribute(surplus);
      await distributor.distribute(surplus);

      const zkPool = (surplus * 1000n) / 10000n;
      const aiShare = (zkPool * 500n) / 10000n;

      expect(await distributor.aiAgentPool()).to.equal(aiShare * 2n);
    });
  });

  // ── Claim ZK Bonus ──────────────────────────────────────────
  describe("Claim ZK Bonus", function () {
    beforeEach(async function () {
      // Fund the pool first
      await distributor.distribute(100000n);
    });

    it("Should allow claiming from ZK pool", async function () {
      const poolBefore = await distributor.zkBonusPool();
      const claimAmount = 100n;

      await distributor.connect(addr1).claimZKBonus(claimAmount, 1);

      expect(await distributor.zkBonusPool()).to.equal(poolBefore - claimAmount);
    });

    it("Should emit ZKBonusClaimed event", async function () {
      await expect(distributor.connect(addr1).claimZKBonus(100n, 2))
        .to.emit(distributor, "ZKBonusClaimed")
        .withArgs(addr1.address, 100n, 2n);
    });

    it("Should revert on zero claim", async function () {
      await expect(
        distributor.connect(addr1).claimZKBonus(0, 1)
      ).to.be.revertedWith("Zero amount");
    });

    it("Should revert if pool has insufficient funds", async function () {
      const poolAmount = await distributor.zkBonusPool();
      await expect(
        distributor.connect(addr1).claimZKBonus(poolAmount + 1n, 1)
      ).to.be.revertedWith("Insufficient pool");
    });

    it("Should allow multiple claims from different addresses", async function () {
      await distributor.connect(addr1).claimZKBonus(100n, 1);
      await distributor.connect(addr2).claimZKBonus(100n, 2);

      const poolAfter = await distributor.zkBonusPool();
      const poolBefore = (100000n * 1000n / 10000n) - (100000n * 1000n / 10000n * 500n / 10000n);
      expect(poolAfter).to.equal(poolBefore - 200n);
    });
  });
});

// ─────────────────────────────────────────────────────────────
//  ZK VERIFIER TESTS
// ─────────────────────────────────────────────────────────────
describe("ZKVerifier", function () {
  let verifier;
  let owner, addr1, addr2;

  // Helper to generate unique nullifier
  function makeNullifier(n) {
    return ethers.zeroPadValue(ethers.toBeHex(n), 32);
  }

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    verifier = await ZKVerifier.deploy();
    await verifier.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────
  describe("Deployment", function () {
    it("Should deploy with empty nullifier mapping", async function () {
      const nullifier = makeNullifier(1);
      expect(await verifier.usedNullifiers(nullifier)).to.equal(false);
    });
  });

  // ── Claim Bonus ─────────────────────────────────────────────
  describe("Claim Bonus", function () {
    // Dummy proof values (placeholder — real ZK circuit not deployed in tests)
    const dummyA = [0n, 0n];
    const dummyB = [[0n, 0n], [0n, 0n]];
    const dummyC = [0n, 0n];

    it("Should claim bonus and mark nullifier as used", async function () {
      const nullifierNum = 12345n;
      const publicInputs = [1n, 500n, nullifierNum]; // category=1, score=500

      await verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs);

      const nullifierBytes = ethers.zeroPadValue(ethers.toBeHex(nullifierNum), 32);
      expect(await verifier.usedNullifiers(nullifierBytes)).to.equal(true);
    });

    it("Should emit BonusClaimed event with correct args", async function () {
      const nullifierNum = 99999n;
      const category = 2n;
      const score = 800n;
      const publicInputs = [category, score, nullifierNum];
      const nullifierBytes = ethers.zeroPadValue(ethers.toBeHex(nullifierNum), 32);
      const expectedBonus = score * BigInt(1e18);

      await expect(
        verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs)
      )
        .to.emit(verifier, "BonusClaimed")
        .withArgs(nullifierBytes, category, score, expectedBonus);
    });

    it("Should calculate bonus as score * 1e18", async function () {
      const score = 750n;
      const publicInputs = [1n, score, 11111n];

      const tx = await verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs);
      const receipt = await tx.wait();
      const event = receipt.logs[0];

      // bonus = score * 1e18
      const expectedBonus = score * BigInt("1000000000000000000");
      expect(event.args[3]).to.equal(expectedBonus);
    });

    it("Should revert on double-claim with same nullifier", async function () {
      const publicInputs = [1n, 500n, 55555n];

      await verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs);

      await expect(
        verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs)
      ).to.be.revertedWith("Already claimed");
    });

    it("Should allow different nullifiers to claim independently", async function () {
      const inputs1 = [1n, 500n, 11111n];
      const inputs2 = [1n, 500n, 22222n];

      await verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, inputs1);
      await verifier.connect(addr2).claimBonus(dummyA, dummyB, dummyC, inputs2);

      const n1 = ethers.zeroPadValue(ethers.toBeHex(11111n), 32);
      const n2 = ethers.zeroPadValue(ethers.toBeHex(22222n), 32);
      expect(await verifier.usedNullifiers(n1)).to.equal(true);
      expect(await verifier.usedNullifiers(n2)).to.equal(true);
    });

    it("Should allow different addresses to claim with different nullifiers", async function () {
      await verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, [1n, 100n, 1n]);
      await verifier.connect(addr2).claimBonus(dummyA, dummyB, dummyC, [2n, 200n, 2n]);
      // No revert = success
    });

    it("Should handle zero score correctly", async function () {
      const publicInputs = [1n, 0n, 77777n];
      await expect(
        verifier.connect(addr1).claimBonus(dummyA, dummyB, dummyC, publicInputs)
      ).to.not.be.reverted;
    });
  });
});

// ─────────────────────────────────────────────────────────────
//  INTEGRATION TESTS — Vault + Distributor
// ─────────────────────────────────────────────────────────────
describe("Integration — YeldenVault + YeldenDistributor", function () {
  let vault, distributor, mockUSDC;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();

    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(
      await mockUSDC.getAddress(),
      "Yelden USD",
      "yUSD"
    );
    await vault.waitForDeployment();

    const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
    distributor = await YeldenDistributor.deploy();
    await distributor.waitForDeployment();

    // Fund users
    await mockUSDC.mint(user1.address, ethers.parseUnits("50000", 6));
    await mockUSDC.mint(user2.address, ethers.parseUnits("50000", 6));
  });

  it("Full cycle: deposit → harvest → distribute → claim", async function () {
    // 1. User1 deposits 10,000 USDC
    const depositAmount = ethers.parseUnits("10000", 6);
    await mockUSDC.connect(user1).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user1).deposit(depositAmount, user1.address);
    expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);

    // 2. User2 deposits 20,000 USDC
    const deposit2 = ethers.parseUnits("20000", 6);
    await mockUSDC.connect(user2).approve(await vault.getAddress(), deposit2);
    await vault.connect(user2).deposit(deposit2, user2.address);

    // 3. Owner harvests yield
    const grossYield = ethers.parseUnits("1000", 6);
    const tx = await vault.harvest(grossYield);
    const receipt = await tx.wait();
    const harvestEvent = receipt.logs.find(
      l => l.fragment && l.fragment.name === "Harvest"
    );
    expect(harvestEvent).to.not.be.undefined;

    // 4. Distribute the surplus
    const base = (grossYield * 450n) / 10000n;
    const regen = (grossYield * 500n) / 10000n;
    const surplus = grossYield - base - regen;
    const reserve = (surplus * 2000n) / 10000n;
    const distributableSurplus = surplus - reserve;

    await distributor.distribute(distributableSurplus);

    // 5. Verify pools are funded
    const zkPool = (distributableSurplus * 1000n) / 10000n;
    const aiShare = (zkPool * 500n) / 10000n;
    expect(await distributor.zkBonusPool()).to.equal(zkPool - aiShare);
    expect(await distributor.aiAgentPool()).to.equal(aiShare);

    // 6. User claims ZK bonus
    const claimAmount = 10n;
    await distributor.connect(user1).claimZKBonus(claimAmount, 1);
    expect(await distributor.zkBonusPool()).to.equal(zkPool - aiShare - claimAmount);
  });

  it("Should preserve share ratio across deposits and withdrawals", async function () {
    const amount1 = ethers.parseUnits("1000", 6);
    const amount2 = ethers.parseUnits("3000", 6);

    await mockUSDC.connect(user1).approve(await vault.getAddress(), amount1);
    await vault.connect(user1).deposit(amount1, user1.address);

    await mockUSDC.connect(user2).approve(await vault.getAddress(), amount2);
    await vault.connect(user2).deposit(amount2, user2.address);

    // user1 has 1/4 of total, user2 has 3/4
    const totalSupply = await vault.totalSupply();
    expect(await vault.balanceOf(user1.address)).to.equal(totalSupply / 4n);
    expect(await vault.balanceOf(user2.address)).to.equal((totalSupply * 3n) / 4n);

    // user1 withdraws everything
    const user1Shares = await vault.balanceOf(user1.address);
    const user1Assets = await vault.convertToAssets(user1Shares);
    await vault.connect(user1).withdraw(user1Assets, user1.address, user1.address);

    expect(await vault.balanceOf(user1.address)).to.equal(0);
    expect(await vault.totalAssets()).to.equal(amount2);
  });

  it("Bear market: yieldReserve accumulates over multiple harvests", async function () {
    const grossYield = ethers.parseUnits("1000", 6);

    for (let i = 0; i < 5; i++) {
      await vault.harvest(grossYield);
    }

    const surplus = grossYield - (grossYield * 450n) / 10000n - (grossYield * 500n) / 10000n;
    const reservePerHarvest = (surplus * 2000n) / 10000n;
    const expectedTotal = reservePerHarvest * 5n;

    expect(await vault.yieldReserve()).to.equal(expectedTotal);
  });
});
