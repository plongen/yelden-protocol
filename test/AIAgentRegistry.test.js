const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * AIAgentRegistry — Test Suite
 *
 * Covers:
 * - Deployment and roles
 * - registerAgent() — permissionless + stake
 * - approveAgent() — SCORER_ROLE
 * - slashAgent() — WARNING, SUSPENSION, BAN
 * - voluntaryExit() — PENDING only
 * - updateScore() + updateScoreBatch()
 * - isEligible() / isActive() / stakeOf()
 * - setStakeToken() — YLD migration
 * - migrateStake()
 * - setVault() / setMinStake() — admin
 * - receiveSlash() on YeldenVault
 */

describe("AIAgentRegistry", function () {
  let registry, vault, usdc, owner, slasher, scorer, agent1, agent2, agent3;

  const MIN_STAKE = ethers.parseUnits("100", 6); // 100 USDC
  const INITIAL_MINT = ethers.parseUnits("10000", 6); // 10,000 USDC each

  async function deployAll() {
    [owner, slasher, scorer, agent1, agent2, agent3] = await ethers.getSigners();

    // Deploy MockERC20 as USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();

    // Mint USDC to agents
    for (const signer of [agent1, agent2, agent3]) {
      await usdc.mint(signer.address, INITIAL_MINT);
    }

    // Deploy vault (needs asset)
    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(await usdc.getAddress(), "Yelden USD", "yUSD");
    await vault.waitForDeployment();

    // Deploy registry
    const Registry = await ethers.getContractFactory("AIAgentRegistry");
    registry = await Registry.deploy(
      await usdc.getAddress(),
      MIN_STAKE,
      await vault.getAddress(),
      owner.address
    );
    await registry.waitForDeployment();

    // Connect vault → registry
    await vault.setRegistry(await registry.getAddress());

    // Grant roles
    const SLASHER_ROLE = await registry.SLASHER_ROLE();
    const SCORER_ROLE  = await registry.SCORER_ROLE();
    await registry.grantRole(SLASHER_ROLE, slasher.address);
    await registry.grantRole(SCORER_ROLE,  scorer.address);

    return { registry, vault, usdc };
  }

  async function registerAndApprove(agent, name = "TestAgent", type = "monitor", stake = MIN_STAKE) {
    await usdc.connect(agent).approve(await registry.getAddress(), stake);
    await registry.connect(agent).registerAgent(name, type, stake);
    await registry.connect(scorer).approveAgent(agent.address);
  }

  // ─── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should set stake token to USDC", async function () {
      expect(await registry.stakeToken()).to.equal(await usdc.getAddress());
    });

    it("Should set minStake correctly", async function () {
      expect(await registry.minStake()).to.equal(MIN_STAKE);
    });

    it("Should set vault correctly", async function () {
      expect(await registry.vault()).to.equal(await vault.getAddress());
    });

    it("Should grant DEFAULT_ADMIN_ROLE to owner", async function () {
      const role = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(role, owner.address)).to.be.true;
    });

    it("Should start with zero agents", async function () {
      expect(await registry.totalAgents()).to.equal(0);
      expect(await registry.totalActive()).to.equal(0);
    });
  });

  // ─── Registration ────────────────────────────────────────────────────────────

  describe("registerAgent()", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should register agent with correct stake", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);

      const a = await registry.getAgent(agent1.address);
      expect(a.status).to.equal(1); // PENDING
      expect(a.stake).to.equal(MIN_STAKE);
      expect(a.name).to.equal("Agent Alpha");
      expect(a.agentType).to.equal("monitor");
    });

    it("Should emit AgentRegistered event", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE))
        .to.emit(registry, "AgentRegistered")
        .withArgs(agent1.address, "Agent Alpha", "monitor", MIN_STAKE, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
    });

    it("Should transfer stake to registry", async function () {
      const before = await usdc.balanceOf(await registry.getAddress());
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      const after = await usdc.balanceOf(await registry.getAddress());
      expect(after - before).to.equal(MIN_STAKE);
    });

    it("Should revert if stake below minimum", async function () {
      const lowStake = ethers.parseUnits("50", 6);
      await usdc.connect(agent1).approve(await registry.getAddress(), lowStake);
      await expect(
        registry.connect(agent1).registerAgent("Agent Alpha", "monitor", lowStake)
      ).to.be.revertedWith("Registry: stake below minimum");
    });

    it("Should revert if already registered", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE * 2n);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent("Agent Alpha 2", "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: already registered");
    });

    it("Should revert if name is empty", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent("", "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: name required");
    });

    it("Should revert if name is too long", async function () {
      const longName = "A".repeat(65);
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent(longName, "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: name too long");
    });

    it("Should allow stake above minimum", async function () {
      const bigStake = ethers.parseUnits("500", 6);
      await usdc.connect(agent1).approve(await registry.getAddress(), bigStake);
      await registry.connect(agent1).registerAgent("Rich Agent", "optimizer", bigStake);
      expect(await registry.stakeOf(agent1.address)).to.equal(bigStake);
    });

    it("Should increment totalRegistered", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      expect(await registry.totalRegistered()).to.equal(1);
    });
  });

  // ─── Approval ─────────────────────────────────────────────────────────────────

  describe("approveAgent()", function () {
    beforeEach(async function () {
      await deployAll();
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
    });

    it("Should approve pending agent", async function () {
      await registry.connect(scorer).approveAgent(agent1.address);
      expect(await registry.isActive(agent1.address)).to.be.true;
      expect((await registry.getAgent(agent1.address)).score).to.equal(500);
    });

    it("Should emit AgentApproved event", async function () {
      await expect(registry.connect(scorer).approveAgent(agent1.address))
        .to.emit(registry, "AgentApproved")
        .withArgs(agent1.address, scorer.address, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
    });

    it("Should increment totalActive", async function () {
      await registry.connect(scorer).approveAgent(agent1.address);
      expect(await registry.totalActive()).to.equal(1);
    });

    it("Should revert if not SCORER_ROLE", async function () {
      await expect(
        registry.connect(agent2).approveAgent(agent1.address)
      ).to.be.reverted;
    });

    it("Should revert if agent not pending", async function () {
      await registry.connect(scorer).approveAgent(agent1.address);
      await expect(
        registry.connect(scorer).approveAgent(agent1.address)
      ).to.be.revertedWith("Registry: not pending");
    });
  });

  // ─── Slashing ─────────────────────────────────────────────────────────────────

  describe("slashAgent()", function () {
    beforeEach(async function () {
      await deployAll();
      await registerAndApprove(agent1, "Agent Alpha", "monitor", MIN_STAKE);
    });

    describe("WARNING (10%)", function () {
      it("Should cut 10% of stake", async function () {
        const stakeBefore = await registry.stakeOf(agent1.address);
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low performance");
        const stakeAfter = await registry.stakeOf(agent1.address);
        const expected = stakeBefore - (stakeBefore * 10n / 100n);
        expect(stakeAfter).to.equal(expected);
      });

      it("Should keep agent ACTIVE", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low performance");
        expect(await registry.isActive(agent1.address)).to.be.true;
      });

      it("Should increment warningCount", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low performance");
        expect((await registry.getAgent(agent1.address)).warningCount).to.equal(1);
      });

      it("Should send slashed amount to vault", async function () {
        const reserveBefore = await vault.yieldReserve();
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low performance");
        const reserveAfter = await vault.yieldReserve();
        const expected = MIN_STAKE * 10n / 100n;
        expect(reserveAfter - reserveBefore).to.equal(expected);
      });

      it("Should emit AgentSlashed event", async function () {
        const slashAmount = MIN_STAKE * 10n / 100n;
        const remaining   = MIN_STAKE - slashAmount;
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 0, "Low performance")
        ).to.emit(registry, "AgentSlashed")
          .withArgs(agent1.address, 0, slashAmount, remaining, "Low performance", await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
      });

      it("Should accumulate multiple warnings", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning 1");
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning 2");
        expect((await registry.getAgent(agent1.address)).warningCount).to.equal(2);
      });
    });

    describe("SUSPENSION (50%)", function () {
      it("Should cut 50% of stake", async function () {
        const stakeBefore = await registry.stakeOf(agent1.address);
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious behavior");
        const stakeAfter = await registry.stakeOf(agent1.address);
        expect(stakeAfter).to.equal(stakeBefore / 2n);
      });

      it("Should set status to PENDING", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious behavior");
        expect(await registry.isActive(agent1.address)).to.be.false;
        expect((await registry.getAgent(agent1.address)).status).to.equal(1); // PENDING
      });

      it("Should decrement totalActive", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious behavior");
        expect(await registry.totalActive()).to.equal(0);
      });

      it("Should send 50% to vault yieldReserve", async function () {
        const reserveBefore = await vault.yieldReserve();
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious behavior");
        const reserveAfter = await vault.yieldReserve();
        expect(reserveAfter - reserveBefore).to.equal(MIN_STAKE / 2n);
      });
    });

    describe("BAN (100%)", function () {
      it("Should cut 100% of stake", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious behavior");
        expect(await registry.stakeOf(agent1.address)).to.equal(0);
      });

      it("Should set status to BANNED", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious behavior");
        expect((await registry.getAgent(agent1.address)).status).to.equal(3); // BANNED
      });

      it("Should send full stake to vault", async function () {
        const reserveBefore = await vault.yieldReserve();
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious behavior");
        const reserveAfter = await vault.yieldReserve();
        expect(reserveAfter - reserveBefore).to.equal(MIN_STAKE);
      });

      it("Should emit AgentBanned event", async function () {
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious behavior")
        ).to.emit(registry, "AgentBanned");
      });

      it("Should revert further slashing after BAN", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious behavior");
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 0, "Another warning")
        ).to.be.revertedWith("Registry: agent not slashable");
      });
    });

    it("Should revert if caller is not SLASHER_ROLE", async function () {
      await expect(
        registry.connect(agent2).slashAgent(agent1.address, 0, "Unauthorized")
      ).to.be.reverted;
    });

    it("Should update totalSlashedAmount", async function () {
      await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning");
      expect(await registry.totalSlashedAmount()).to.equal(MIN_STAKE * 10n / 100n);
    });
  });

  // ─── Voluntary Exit ───────────────────────────────────────────────────────────

  describe("voluntaryExit()", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should return full stake to PENDING agent", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);

      const balBefore = await usdc.balanceOf(agent1.address);
      await registry.connect(agent1).voluntaryExit();
      const balAfter = await usdc.balanceOf(agent1.address);

      expect(balAfter - balBefore).to.equal(MIN_STAKE);
    });

    it("Should set status to NONE", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await registry.connect(agent1).voluntaryExit();
      expect((await registry.getAgent(agent1.address)).status).to.equal(0); // NONE
    });

    it("Should emit AgentExited event", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await expect(registry.connect(agent1).voluntaryExit())
        .to.emit(registry, "AgentExited")
        .withArgs(agent1.address, MIN_STAKE, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
    });

    it("Should revert if agent is ACTIVE", async function () {
      await registerAndApprove(agent1);
      await expect(registry.connect(agent1).voluntaryExit())
        .to.be.revertedWith("Registry: only PENDING agents can exit");
    });
  });

  // ─── Score ────────────────────────────────────────────────────────────────────

  describe("updateScore()", function () {
    beforeEach(async function () {
      await deployAll();
      await registerAndApprove(agent1);
    });

    it("Should update score correctly", async function () {
      await registry.connect(scorer).updateScore(agent1.address, 750);
      expect(await registry.score(agent1.address)).to.equal(750);
    });

    it("Should emit ScoreUpdated event", async function () {
      await expect(registry.connect(scorer).updateScore(agent1.address, 750))
        .to.emit(registry, "ScoreUpdated")
        .withArgs(agent1.address, 500, 750, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
    });

    it("Should revert if score exceeds MAX_SCORE", async function () {
      await expect(
        registry.connect(scorer).updateScore(agent1.address, 1001)
      ).to.be.revertedWith("Registry: score exceeds max");
    });

    it("Should revert if agent not active", async function () {
      await usdc.connect(agent2).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent2).registerAgent("Agent Beta", "monitor", MIN_STAKE);
      await expect(
        registry.connect(scorer).updateScore(agent2.address, 750)
      ).to.be.revertedWith("Registry: not active");
    });
  });

  describe("updateScoreBatch()", function () {
    beforeEach(async function () {
      await deployAll();
      await registerAndApprove(agent1, "Agent 1", "monitor");
      await registerAndApprove(agent2, "Agent 2", "optimizer");
    });

    it("Should update multiple scores", async function () {
      await registry.connect(scorer).updateScoreBatch(
        [agent1.address, agent2.address],
        [700, 800]
      );
      expect(await registry.score(agent1.address)).to.equal(700);
      expect(await registry.score(agent2.address)).to.equal(800);
    });

    it("Should skip inactive agents silently", async function () {
      await usdc.connect(agent3).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent3).registerAgent("Agent 3", "monitor", MIN_STAKE);
      // agent3 is PENDING — should be skipped
      await registry.connect(scorer).updateScoreBatch(
        [agent1.address, agent3.address],
        [700, 900]
      );
      expect(await registry.score(agent1.address)).to.equal(700);
      expect(await registry.score(agent3.address)).to.equal(0); // unchanged
    });

    it("Should revert if arrays length mismatch", async function () {
      await expect(
        registry.connect(scorer).updateScoreBatch([agent1.address], [700, 800])
      ).to.be.revertedWith("Registry: length mismatch");
    });

    it("Should revert if batch too large", async function () {
      const addrs  = Array(51).fill(agent1.address);
      const scores = Array(51).fill(700);
      await expect(
        registry.connect(scorer).updateScoreBatch(addrs, scores)
      ).to.be.revertedWith("Registry: batch too large");
    });
  });

  // ─── View Functions ───────────────────────────────────────────────────────────

  describe("isEligible()", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should return true for ACTIVE agent with score >= 500", async function () {
      await registerAndApprove(agent1);
      expect(await registry.isEligible(agent1.address)).to.be.true;
    });

    it("Should return false for ACTIVE agent with score < 500", async function () {
      await registerAndApprove(agent1);
      await registry.connect(scorer).updateScore(agent1.address, 499);
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });

    it("Should return false for PENDING agent", async function () {
      await usdc.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });

    it("Should return false for BANNED agent", async function () {
      await registerAndApprove(agent1);
      await registry.connect(slasher).slashAgent(agent1.address, 2, "Ban");
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });
  });

  // ─── Admin ────────────────────────────────────────────────────────────────────

  describe("Admin functions", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should update vault address", async function () {
      const newVault = agent3.address;
      await registry.connect(owner).setVault(newVault);
      expect(await registry.vault()).to.equal(newVault);
    });

    it("Should revert setVault if not admin", async function () {
      await expect(
        registry.connect(agent1).setVault(agent3.address)
      ).to.be.reverted;
    });

    it("Should update minStake", async function () {
      const newMin = ethers.parseUnits("200", 6);
      await registry.connect(owner).setMinStake(newMin);
      expect(await registry.minStake()).to.equal(newMin);
    });
  });

  // ─── YeldnVault.receiveSlash() ────────────────────────────────────────────────

  describe("YeldenVault.receiveSlash()", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should revert if caller is not registry", async function () {
      await expect(
        vault.connect(owner).receiveSlash(100)
      ).to.be.revertedWith("Vault: caller is not registry");
    });

    it("Should accumulate slash into yieldReserve via slash flow", async function () {
      await registerAndApprove(agent1);
      const reserveBefore = await vault.yieldReserve();
      await registry.connect(slasher).slashAgent(agent1.address, 2, "Ban test");
      const reserveAfter = await vault.yieldReserve();
      expect(reserveAfter - reserveBefore).to.equal(MIN_STAKE);
    });
  });

  // ─── Full Slash Cycle ─────────────────────────────────────────────────────────

  describe("Full slash cycle", function () {
    it("Should handle register → approve → warn → suspend → ban → vault receives all", async function () {
      await deployAll();

      const bigStake = ethers.parseUnits("1000", 6);
      await usdc.connect(agent1).mint
        ? null
        : await usdc.mint(agent1.address, bigStake);
      await usdc.connect(agent1).approve(await registry.getAddress(), bigStake);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", bigStake);
      await registry.connect(scorer).approveAgent(agent1.address);

      const reserveStart = await vault.yieldReserve();

      // WARNING — 10% = 100 USDC
      await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning 1");
      expect(await registry.isActive(agent1.address)).to.be.true;

      // SUSPENSION — 50% of remaining 900 = 450 USDC
      await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspension");
      expect((await registry.getAgent(agent1.address)).status).to.equal(1);

      // BAN — 100% of remaining 450 = 450 USDC
      await registry.connect(slasher).slashAgent(agent1.address, 2, "Ban");
      expect((await registry.getAgent(agent1.address)).status).to.equal(3);
      expect(await registry.stakeOf(agent1.address)).to.equal(0);

      // Total slashed = 100 + 450 + 450 = 1000 USDC → all to vault
      const reserveEnd = await vault.yieldReserve();
      expect(reserveEnd - reserveStart).to.equal(bigStake);
    });
  });
});
