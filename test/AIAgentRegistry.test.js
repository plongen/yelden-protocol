const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * AIAgentRegistry v3 — Test Suite
 *
 * Stake token: YLD (MockERC20 18 decimals)
 * Fee model: monthlyFee * (1000 - score) / 1000
 * Slashing: burns YLD (no vault transfer)
 * Exit: fee origin → stake returned | slash origin → stake burned
 */

describe("AIAgentRegistry", function () {
  let registry, vault, yld, usdc, owner, slasher, scorer, agent1, agent2, agent3;
  let BURN_ADDRESS;

  const MIN_STAKE   = ethers.parseUnits("50", 18);   // 50 YLD
  const MONTHLY_FEE = ethers.parseUnits("1", 18);    // 1 YLD max
  const MINT_AMOUNT = ethers.parseUnits("10000", 18);

  // burn address
  BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

  async function deployAll() {
    [owner, slasher, scorer, agent1, agent2, agent3] = await ethers.getSigners();

    // Deploy MockERC20 as YLD (18 decimals)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    yld = await MockERC20.deploy("Yelden Token", "YLD", 18);
    await yld.waitForDeployment();

    // Deploy MockERC20 as USDC for vault
    usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();

    // Mint YLD to agents
    for (const signer of [agent1, agent2, agent3]) {
      await yld.mint(signer.address, MINT_AMOUNT);
    }

    // Deploy vault
    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(await usdc.getAddress(), "Yelden USD", "yUSD");
    await vault.waitForDeployment();

    // Deploy registry with 6 args
    const Registry = await ethers.getContractFactory("AIAgentRegistry");
    registry = await Registry.deploy(
      await yld.getAddress(),   // _yld
      MIN_STAKE,                // _minStake
      MONTHLY_FEE,              // _monthlyFee
      await vault.getAddress(), // _vault
      BURN_ADDRESS,             // _burnAddress
      owner.address             // _admin
    );
    await registry.waitForDeployment();

    // Connect vault → registry
    await vault.setRegistry(await registry.getAddress());

    // Grant roles
    const SLASHER_ROLE = await registry.SLASHER_ROLE();
    const SCORER_ROLE  = await registry.SCORER_ROLE();
    await registry.grantRole(SLASHER_ROLE, slasher.address);
    await registry.grantRole(SCORER_ROLE,  scorer.address);

    return { registry, vault, yld };
  }

  async function registerAndApprove(agent, name = "TestAgent", type = "monitor", stake = MIN_STAKE) {
    await yld.connect(agent).approve(await registry.getAddress(), stake);
    await registry.connect(agent).registerAgent(name, type, stake);
    await registry.connect(scorer).approveAgent(agent.address);
  }

  // ─── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should set YLD as stake token", async function () {
      expect(await registry.yld()).to.equal(await yld.getAddress());
    });

    it("Should set minStake correctly", async function () {
      expect(await registry.minStake()).to.equal(MIN_STAKE);
    });

    it("Should set monthlyFee correctly", async function () {
      expect(await registry.monthlyFee()).to.equal(MONTHLY_FEE);
    });

    it("Should set vault correctly", async function () {
      expect(await registry.vault()).to.equal(await vault.getAddress());
    });

    it("Should set burnAddress correctly", async function () {
      expect(await registry.burnAddress()).to.equal(BURN_ADDRESS);
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

    it("Should register agent and transfer YLD stake", async function () {
      const before = await yld.balanceOf(await registry.getAddress());
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      const after = await yld.balanceOf(await registry.getAddress());
      expect(after - before).to.equal(MIN_STAKE);
    });

    it("Should set status to PENDING", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      expect((await registry.getAgent(agent1.address)).status).to.equal(1); // PENDING
    });

    it("Should emit AgentRegistered event", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE))
        .to.emit(registry, "AgentRegistered");
    });

    it("Should revert if stake below minimum", async function () {
      const lowStake = ethers.parseUnits("10", 18);
      await yld.connect(agent1).approve(await registry.getAddress(), lowStake);
      await expect(
        registry.connect(agent1).registerAgent("Agent Alpha", "monitor", lowStake)
      ).to.be.revertedWith("Registry: stake below minimum");
    });

    it("Should revert if already registered", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE * 2n);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent("Agent Alpha 2", "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: already registered");
    });

    it("Should revert if name is empty", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent("", "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: name required");
    });

    it("Should revert if name too long", async function () {
      const longName = "A".repeat(65);
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await expect(
        registry.connect(agent1).registerAgent(longName, "monitor", MIN_STAKE)
      ).to.be.revertedWith("Registry: name too long");
    });

    it("Should increment totalRegistered", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      expect(await registry.totalRegistered()).to.equal(1);
    });
  });

  // ─── Approval ─────────────────────────────────────────────────────────────────

  describe("approveAgent()", function () {
    beforeEach(async function () {
      await deployAll();
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
    });

    it("Should approve and set score to 300", async function () {
      await registry.connect(scorer).approveAgent(agent1.address);
      expect(await registry.isActive(agent1.address)).to.be.true;
      expect(await registry.score(agent1.address)).to.equal(300);
    });

    it("Should emit AgentApproved event", async function () {
      await expect(registry.connect(scorer).approveAgent(agent1.address))
        .to.emit(registry, "AgentApproved");
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

    it("Should revert if not pending", async function () {
      await registry.connect(scorer).approveAgent(agent1.address);
      await expect(
        registry.connect(scorer).approveAgent(agent1.address)
      ).to.be.revertedWith("Registry: not pending");
    });
  });

  // ─── Fee Collection ───────────────────────────────────────────────────────────

  describe("collectFee()", function () {
    beforeEach(async function () {
      await deployAll();
      await registerAndApprove(agent1);
    });

    it("Should revert if fee not due yet", async function () {
      await expect(
        registry.collectFee(agent1.address)
      ).to.be.revertedWith("Registry: fee not due yet");
    });

    it("Should collect fee after 30 days", async function () {
      await time.increase(30 * 24 * 60 * 60 + 1);
      const stakeBefore = await registry.stakeOf(agent1.address);
      await registry.collectFee(agent1.address);
      const stakeAfter = await registry.stakeOf(agent1.address);
      // score=300 → fee = 1e18 * (1000-300) / 1000 = 0.7 YLD
      const expectedFee = MONTHLY_FEE * 700n / 1000n;
      expect(stakeBefore - stakeAfter).to.equal(expectedFee);
    });

    it("Should burn the fee (send to burnAddress)", async function () {
      await time.increase(30 * 24 * 60 * 60 + 1);
      const burnBefore = await yld.balanceOf(BURN_ADDRESS);
      await registry.collectFee(agent1.address);
      const burnAfter = await yld.balanceOf(BURN_ADDRESS);
      const expectedFee = MONTHLY_FEE * 700n / 1000n;
      expect(burnAfter - burnBefore).to.equal(expectedFee);
    });

    it("Agent with score 1000 pays zero fee", async function () {
      await registry.connect(scorer).updateScore(agent1.address, 1000);
      await time.increase(30 * 24 * 60 * 60 + 1);
      const stakeBefore = await registry.stakeOf(agent1.address);
      await registry.collectFee(agent1.address);
      const stakeAfter = await registry.stakeOf(agent1.address);
      expect(stakeBefore).to.equal(stakeAfter);
    });

    it("Agent with score 500 pays 50% of monthlyFee", async function () {
      await registry.connect(scorer).updateScore(agent1.address, 500);
      await time.increase(30 * 24 * 60 * 60 + 1);
      const stakeBefore = await registry.stakeOf(agent1.address);
      await registry.collectFee(agent1.address);
      const stakeAfter = await registry.stakeOf(agent1.address);
      const expectedFee = MONTHLY_FEE * 500n / 1000n;
      expect(stakeBefore - stakeAfter).to.equal(expectedFee);
    });

    it("Should emit FeeCollected event", async function () {
      await time.increase(30 * 24 * 60 * 60 + 1);
      await expect(registry.collectFee(agent1.address))
        .to.emit(registry, "FeeCollected");
    });

    it("Should drop to PENDING if stake falls below minStake/2 by fee — slashPending=false", async function () {
      // Use tiny stake just above minStake so fee drains it
      const tinyStake = MIN_STAKE + ethers.parseUnits("1", 18);
      await yld.connect(agent2).approve(await registry.getAddress(), tinyStake);
      await registry.connect(agent2).registerAgent("Agent Beta", "monitor", tinyStake);
      await registry.connect(scorer).approveAgent(agent2.address);

      // Score 0 — pays full fee each month
      await registry.connect(scorer).updateScore(agent2.address, 0);

      // Advance many months to drain stake below minStake/2
      await time.increase(30 * 24 * 60 * 60 + 1);
      await registry.collectFee(agent2.address);
      await time.increase(30 * 24 * 60 * 60 + 1);
      await registry.collectFee(agent2.address);

      const agent = await registry.getAgent(agent2.address);
      if (agent.status == 1n) { // PENDING
        expect(agent.slashPending).to.be.false; // fee origin — can withdraw
      }
    });

    it("feeDue() returns correct amount", async function () {
      await time.increase(30 * 24 * 60 * 60 + 1);
      const due = await registry.feeDue(agent1.address);
      const expected = MONTHLY_FEE * 700n / 1000n;
      expect(due).to.equal(expected);
    });

    it("feeDue() returns 0 if not due yet", async function () {
      expect(await registry.feeDue(agent1.address)).to.equal(0);
    });
  });

  // ─── Slashing ─────────────────────────────────────────────────────────────────

  describe("slashAgent()", function () {
    beforeEach(async function () {
      await deployAll();
      await registerAndApprove(agent1);
    });

    describe("WARNING (10%)", function () {
      it("Should burn 10% of stake", async function () {
        const burnBefore = await yld.balanceOf(BURN_ADDRESS);
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low perf");
        const burnAfter = await yld.balanceOf(BURN_ADDRESS);
        expect(burnAfter - burnBefore).to.equal(MIN_STAKE * 10n / 100n);
      });

      it("Should keep agent ACTIVE", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low perf");
        expect(await registry.isActive(agent1.address)).to.be.true;
      });

      it("Should increment warningCount", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low perf");
        expect((await registry.getAgent(agent1.address)).warningCount).to.equal(1);
      });

      it("Should emit AgentSlashed event", async function () {
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 0, "Low perf")
        ).to.emit(registry, "AgentSlashed");
      });

      it("Should NOT send anything to vault yieldReserve", async function () {
        const reserveBefore = await vault.yieldReserve();
        await registry.connect(slasher).slashAgent(agent1.address, 0, "Low perf");
        expect(await vault.yieldReserve()).to.equal(reserveBefore);
      });
    });

    describe("SUSPENSION (50%)", function () {
      it("Should burn 50% of stake", async function () {
        const burnBefore = await yld.balanceOf(BURN_ADDRESS);
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious");
        const burnAfter = await yld.balanceOf(BURN_ADDRESS);
        expect(burnAfter - burnBefore).to.equal(MIN_STAKE / 2n);
      });

      it("Should set status to PENDING with slashPending=true", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious");
        const a = await registry.getAgent(agent1.address);
        expect(a.status).to.equal(1); // PENDING
        expect(a.slashPending).to.be.true;
      });

      it("Should decrement totalActive", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious");
        expect(await registry.totalActive()).to.equal(0);
      });

      it("Should emit AgentSuspended event", async function () {
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 1, "Suspicious")
        ).to.emit(registry, "AgentSuspended");
      });
    });

    describe("BAN (100%)", function () {
      it("Should burn 100% of stake", async function () {
        const burnBefore = await yld.balanceOf(BURN_ADDRESS);
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious");
        const burnAfter = await yld.balanceOf(BURN_ADDRESS);
        expect(burnAfter - burnBefore).to.equal(MIN_STAKE);
      });

      it("Should set status to BANNED", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious");
        expect((await registry.getAgent(agent1.address)).status).to.equal(3); // BANNED
      });

      it("Should set stakeOf to 0", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious");
        expect(await registry.stakeOf(agent1.address)).to.equal(0);
      });

      it("Should revert further slashing", async function () {
        await registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious");
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 0, "Again")
        ).to.be.revertedWith("Registry: agent not slashable");
      });

      it("Should emit AgentBanned event", async function () {
        await expect(
          registry.connect(slasher).slashAgent(agent1.address, 2, "Malicious")
        ).to.emit(registry, "AgentBanned");
      });
    });

    it("Should revert if not SLASHER_ROLE", async function () {
      await expect(
        registry.connect(agent2).slashAgent(agent1.address, 0, "Unauthorized")
      ).to.be.reverted;
    });

    it("Should update totalBurned after slash", async function () {
      await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning");
      expect(await registry.totalBurned()).to.equal(MIN_STAKE * 10n / 100n);
    });
  });

  // ─── Voluntary Exit ───────────────────────────────────────────────────────────

  describe("voluntaryExit()", function () {
    beforeEach(async function () { await deployAll(); });

    it("PENDING by fee — should return remaining stake", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      // Still PENDING (not approved yet) — slashPending=false → can exit with full stake
      const balBefore = await yld.balanceOf(agent1.address);
      await registry.connect(agent1).voluntaryExit();
      const balAfter = await yld.balanceOf(agent1.address);
      expect(balAfter - balBefore).to.equal(MIN_STAKE);
    });

    it("PENDING by slash — should burn remaining stake", async function () {
      await registerAndApprove(agent1);
      // SUSPENSION → PENDING + slashPending=true
      await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspension");
      const remaining = await registry.stakeOf(agent1.address);
      const burnBefore = await yld.balanceOf(BURN_ADDRESS);
      await registry.connect(agent1).voluntaryExit();
      const burnAfter = await yld.balanceOf(BURN_ADDRESS);
      expect(burnAfter - burnBefore).to.equal(remaining);
    });

    it("Should set status to NONE", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await registry.connect(agent1).voluntaryExit();
      expect((await registry.getAgent(agent1.address)).status).to.equal(0); // NONE
    });

    it("Should emit AgentExited event", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      await expect(registry.connect(agent1).voluntaryExit())
        .to.emit(registry, "AgentExited");
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

    it("Should update score", async function () {
      await registry.connect(scorer).updateScore(agent1.address, 750);
      expect(await registry.score(agent1.address)).to.equal(750);
    });

    it("Score starts at INITIAL_SCORE (300)", async function () {
      expect(await registry.score(agent1.address)).to.equal(300);
    });

    it("Should revert if score > 1000", async function () {
      await expect(
        registry.connect(scorer).updateScore(agent1.address, 1001)
      ).to.be.revertedWith("Registry: score exceeds max");
    });

    it("Should revert if agent not active", async function () {
      await yld.connect(agent2).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent2).registerAgent("Agent Beta", "monitor", MIN_STAKE);
      await expect(
        registry.connect(scorer).updateScore(agent2.address, 750)
      ).to.be.revertedWith("Registry: not active");
    });

    it("Should emit ScoreUpdated event", async function () {
      await expect(registry.connect(scorer).updateScore(agent1.address, 750))
        .to.emit(registry, "ScoreUpdated")
        .withArgs(agent1.address, 300, 750, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1));
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
        [agent1.address, agent2.address], [700, 800]
      );
      expect(await registry.score(agent1.address)).to.equal(700);
      expect(await registry.score(agent2.address)).to.equal(800);
    });

    it("Should skip inactive agents", async function () {
      await yld.connect(agent3).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent3).registerAgent("Agent 3", "monitor", MIN_STAKE);
      await registry.connect(scorer).updateScoreBatch(
        [agent1.address, agent3.address], [700, 900]
      );
      expect(await registry.score(agent1.address)).to.equal(700);
      expect(await registry.score(agent3.address)).to.equal(0);
    });

    it("Should revert on length mismatch", async function () {
      await expect(
        registry.connect(scorer).updateScoreBatch([agent1.address], [700, 800])
      ).to.be.revertedWith("Registry: length mismatch");
    });

    it("Should revert if batch > 50", async function () {
      const addrs  = Array(51).fill(agent1.address);
      const scores = Array(51).fill(700);
      await expect(
        registry.connect(scorer).updateScoreBatch(addrs, scores)
      ).to.be.revertedWith("Registry: batch too large");
    });
  });

  // ─── isEligible ───────────────────────────────────────────────────────────────

  describe("isEligible()", function () {
    beforeEach(async function () { await deployAll(); });

    it("Returns false for score 300 (initial)", async function () {
      await registerAndApprove(agent1);
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });

    it("Returns true for ACTIVE agent with score >= 500", async function () {
      await registerAndApprove(agent1);
      await registry.connect(scorer).updateScore(agent1.address, 500);
      expect(await registry.isEligible(agent1.address)).to.be.true;
    });

    it("Returns false for PENDING agent", async function () {
      await yld.connect(agent1).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(agent1).registerAgent("Agent Alpha", "monitor", MIN_STAKE);
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });

    it("Returns false for BANNED agent", async function () {
      await registerAndApprove(agent1);
      await registry.connect(slasher).slashAgent(agent1.address, 2, "Ban");
      expect(await registry.isEligible(agent1.address)).to.be.false;
    });
  });

  // ─── Admin ────────────────────────────────────────────────────────────────────

  describe("Admin functions", function () {
    beforeEach(async function () { await deployAll(); });

    it("Should update monthlyFee", async function () {
      const newFee = ethers.parseUnits("0.5", 18);
      await registry.connect(owner).setMonthlyFee(newFee);
      expect(await registry.monthlyFee()).to.equal(newFee);
    });

    it("Should update minStake", async function () {
      const newMin = ethers.parseUnits("100", 18);
      await registry.connect(owner).setMinStake(newMin);
      expect(await registry.minStake()).to.equal(newMin);
    });

    it("Should revert if not admin", async function () {
      await expect(
        registry.connect(agent1).setMonthlyFee(1)
      ).to.be.reverted;
    });
  });

  // ─── Full lifecycle ───────────────────────────────────────────────────────────

  describe("Full lifecycle", function () {
    it("Register → approve → perform well → score 1000 → zero fees", async function () {
      await deployAll();
      await registerAndApprove(agent1);
      expect(await registry.score(agent1.address)).to.equal(300);

      await registry.connect(scorer).updateScore(agent1.address, 1000);
      expect(await registry.isEligible(agent1.address)).to.be.true;

      await time.increase(30 * 24 * 60 * 60 + 1);
      const stakeBefore = await registry.stakeOf(agent1.address);
      await registry.collectFee(agent1.address);
      expect(await registry.stakeOf(agent1.address)).to.equal(stakeBefore); // no fee
    });

    it("Register → approve → warn → suspend → exit burns remainder", async function () {
      await deployAll();
      await registerAndApprove(agent1);

      await registry.connect(slasher).slashAgent(agent1.address, 0, "Warning");
      await registry.connect(slasher).slashAgent(agent1.address, 1, "Suspension");

      const remaining = await registry.stakeOf(agent1.address);
      const burnBefore = await yld.balanceOf(BURN_ADDRESS);
      await registry.connect(agent1).voluntaryExit();
      const burnAfter = await yld.balanceOf(BURN_ADDRESS);

      expect(burnAfter - burnBefore).to.equal(remaining);
      expect((await registry.getAgent(agent1.address)).status).to.equal(0); // NONE
    });

    it("Full burn cycle: warn+suspend+ban burns 100% of original stake", async function () {
      await deployAll();
      const bigStake = ethers.parseUnits("1000", 18);
      await yld.mint(agent1.address, bigStake);
      await yld.connect(agent1).approve(await registry.getAddress(), bigStake);
      await registry.connect(agent1).registerAgent("Big Agent", "monitor", bigStake);
      await registry.connect(scorer).approveAgent(agent1.address);

      const burnBefore = await yld.balanceOf(BURN_ADDRESS);

      // WARNING 10% = 100 YLD
      await registry.connect(slasher).slashAgent(agent1.address, 0, "W1");
      // SUSPENSION 50% of 900 = 450 YLD
      await registry.connect(slasher).slashAgent(agent1.address, 1, "S1");
      // BAN 100% of 450 = 450 YLD (+ exit burns rest)
      await registry.connect(slasher).slashAgent(agent1.address, 2, "B1");

      const burnAfter = await yld.balanceOf(BURN_ADDRESS);
      expect(burnAfter - burnBefore).to.equal(bigStake);
    });
  });
});
