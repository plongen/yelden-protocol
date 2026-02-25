const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YeldenVault — Bear Market Simulation (Enhanced)", function () {
  let vault, mockUSDC;
  let owner, user1, user2;

  const DEPOSIT_AMOUNT = ethers.parseUnits("10000", 6);
  const GROSS_YIELD = ethers.parseUnits("5000", 6);
  const BASE_YIELD_BPS = 450; // 4.5%
  const BASIS_POINTS = 10000;

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

    await mockUSDC.mint(user1.address, ethers.parseUnits("100000", 6));
    await mockUSDC.mint(user2.address, ethers.parseUnits("100000", 6));

    // Configuração inicial: usuário deposita
    await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
    await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
  });

  describe("Good Years — Reserve Accumulation", function () {
    it("Should accumulate yield reserve over multiple harvests", async function () {
      const numHarvests = 5;
      let expectedReserve = 0n;

      for (let i = 0; i < numHarvests; i++) {
        const tx = await vault.connect(owner).harvest(GROSS_YIELD);
        const receipt = await tx.wait();
        
        // Pega o reserve do evento Harvest
        const event = receipt.logs.find(
          log => log.fragment && log.fragment.name === "Harvest"
        );
        expectedReserve += event.args[4]; // reserveAdded
      }

      expect(await vault.yieldReserve()).to.equal(expectedReserve);
    });
  });

  describe("Reserve Usage", function () {
    beforeEach(async function () {
      // Acumula reserva
      for (let i = 0; i < 5; i++) {
        await vault.connect(owner).harvest(GROSS_YIELD);
      }
    });

    it("Should allow owner to use reserve", async function () {
      const reserveBefore = await vault.yieldReserve();
      const useAmount = reserveBefore / 2n;

      await expect(vault.connect(owner).useReserve(useAmount))
        .to.emit(vault, "ReserveUsed")
        .withArgs(useAmount, "Bear market supplement");

      expect(await vault.yieldReserve()).to.equal(reserveBefore - useAmount);
    });

    it("Should not allow non-owner to use reserve", async function () {
      const reserve = await vault.yieldReserve();
      await expect(
        vault.connect(user1).useReserve(reserve / 2n)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should not allow using more than available reserve", async function () {
      const reserve = await vault.yieldReserve();
      await expect(
        vault.connect(owner).useReserve(reserve + 1n)
      ).to.be.revertedWith("Reserve insufficient");
    });

    it("Should not allow zero amount", async function () {
      await expect(
        vault.connect(owner).useReserve(0)
      ).to.be.revertedWith("Zero amount");
    });
  });

  describe("Emergency Mode", function () {
    it("Should allow owner to set emergency mode with reduced base yield", async function () {
      const newBaseYield = 300; // 3.0%
      
      await expect(vault.connect(owner).setEmergencyMode(true, newBaseYield))
        .to.emit(vault, "EmergencyModeSet")
        .withArgs(true, newBaseYield);

      expect(await vault.emergencyMode()).to.equal(true);
      expect(await vault.emergencyBaseYield()).to.equal(newBaseYield);
      expect(await vault.getCurrentBaseYield()).to.equal(newBaseYield);
    });

    it("Should not allow setting base yield higher than normal", async function () {
      const invalidBaseYield = 500; // 5.0% > 4.5%
      await expect(
        vault.connect(owner).setEmergencyMode(true, invalidBaseYield)
      ).to.be.revertedWith("Invalid base yield");
    });

    it("Should allow disabling emergency mode", async function () {
      await vault.connect(owner).setEmergencyMode(true, 300);
      await vault.connect(owner).setEmergencyMode(false, 0);

      expect(await vault.emergencyMode()).to.equal(false);
      expect(await vault.getCurrentBaseYield()).to.equal(BASE_YIELD_BPS);
    });

    it("Should not allow non-owner to set emergency mode", async function () {
      await expect(
        vault.connect(user1).setEmergencyMode(true, 300)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Full Bear Market Simulation", function () {
    it("Should simulate complete bear market cycle", async function () {
      // Fase 1: Anos bons - acumula reserva
      console.log("\n📈 Fase 1: Anos bons (acumulando reserva)");
      for (let i = 0; i < 10; i++) {
        await vault.connect(owner).harvest(GROSS_YIELD);
      }
      const reserveAfterGood = await vault.yieldReserve();
      console.log(`   Reserve acumulado: ${ethers.formatUnits(reserveAfterGood, 6)} USDC`);

      // Fase 2: Bear market - ativa modo emergência
      console.log("\n🐻 Fase 2: Bear market (modo emergência)");
      await vault.connect(owner).setEmergencyMode(true, 300); // 3.0% base yield
      
      // Usa parte da reserva para complementar
      const useAmount = reserveAfterGood / 10n;
      await vault.connect(owner).useReserve(useAmount);
      console.log(`   Reserve usado: ${ethers.formatUnits(useAmount, 6)} USDC`);

      const reserveAfterUse = await vault.yieldReserve();
      console.log(`   Reserve restante: ${ethers.formatUnits(reserveAfterUse, 6)} USDC`);

      // Fase 3: Recuperação - desativa emergência
      console.log("\n🌱 Fase 3: Recuperação");
      await vault.connect(owner).setEmergencyMode(false, 0);
      await vault.connect(owner).harvest(GROSS_YIELD * 2n);
      
      const reserveAfterRecovery = await vault.yieldReserve();
      console.log(`   Reserve após recuperação: ${ethers.formatUnits(reserveAfterRecovery, 6)} USDC`);

      // Verificações
      expect(reserveAfterRecovery).to.be.gt(reserveAfterUse);
      expect(await vault.getCurrentBaseYield()).to.equal(BASE_YIELD_BPS);
    });
  });

  describe("Test Helper", function () {
    beforeEach(async function () {
      for (let i = 0; i < 5; i++) {
        await vault.connect(owner).harvest(GROSS_YIELD);
      }
    });

    it("Should allow testUseReserve for simulation", async function () {
      const reserveBefore = await vault.yieldReserve();
      const useAmount = reserveBefore / 3n;

      await expect(vault.connect(owner).testUseReserve(useAmount))
        .to.emit(vault, "ReserveUsed")
        .withArgs(useAmount, "Test simulation");

      expect(await vault.yieldReserve()).to.equal(reserveBefore - useAmount);
    });
  });
});