const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployConnected } = require("./helpers");

describe("YeldenVault — Fuzz Testing", function () {
  let vault, distributor, mockUSDC;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const deployment = await deployConnected();
    vault = deployment.vault;
    distributor = deployment.distributor;
    mockUSDC = deployment.usdc;

    await mockUSDC.mint(addr1.address, ethers.parseUnits("10000000", 6));
    await mockUSDC.mint(addr2.address, ethers.parseUnits("10000000", 6));
  });

  describe("Fuzz — Random Deposits", function () {
    it("Should handle 100 random deposit amounts", async function () {
      let totalDeposited = 0n;
      
      for (let i = 0; i < 100; i++) {
        const amount = BigInt(Math.floor(Math.random() * 10000) + 1) * 10n ** 6n;
        
        await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
        await vault.connect(addr1).deposit(amount, addr1.address);
        
        totalDeposited += amount;
        expect(await vault.totalAssets()).to.equal(totalDeposited);
      }
      
      expect(await vault.balanceOf(addr1.address)).to.equal(totalDeposited);
    });

    it("Should handle random deposits from multiple users", async function () {
      let totalDeposited = 0n;
      const users = [addr1, addr2];
      const userBalances = { [addr1.address]: 0n, [addr2.address]: 0n };
      
      for (let i = 0; i < 50; i++) {
        const user = users[Math.floor(Math.random() * users.length)];
        const amount = BigInt(Math.floor(Math.random() * 5000) + 1) * 10n ** 6n;
        
        await mockUSDC.connect(user).approve(await vault.getAddress(), amount);
        await vault.connect(user).deposit(amount, user.address);
        
        userBalances[user.address] += amount;
        totalDeposited += amount;
        
        expect(await vault.totalAssets()).to.equal(totalDeposited);
        expect(await vault.balanceOf(user.address)).to.equal(userBalances[user.address]);
      }
    });
  });

  describe("Fuzz — Random Withdrawals", function () {
    beforeEach(async function () {
      const deposit1 = ethers.parseUnits("10000", 6);
      const deposit2 = ethers.parseUnits("20000", 6);
      
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), deposit1);
      await vault.connect(addr1).deposit(deposit1, addr1.address);
      
      await mockUSDC.connect(addr2).approve(await vault.getAddress(), deposit2);
      await vault.connect(addr2).deposit(deposit2, addr2.address);
    });

    it("Should handle 50 random withdrawals", async function () {
      for (let i = 0; i < 50; i++) {
        const user = i % 2 === 0 ? addr1 : addr2;
        const maxWithdraw = await vault.balanceOf(user.address);
        
        if (maxWithdraw === 0n) continue;
        
        const withdrawAmount = BigInt(
          Math.floor(Math.random() * Number(maxWithdraw / 10n ** 6n)) + 1
        ) * 10n ** 6n;
        
        if (withdrawAmount > maxWithdraw) continue;
        
        await vault.connect(user).withdraw(withdrawAmount, user.address, user.address);
      }
    });
  });

  describe("Fuzz — Random Harvest", function () {
    beforeEach(async function () {
      const deposit = ethers.parseUnits("50000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), deposit);
      await vault.connect(addr1).deposit(deposit, addr1.address);
    });

    it("Should handle 100 random harvest amounts", async function () {
      for (let i = 0; i < 100; i++) {
        const grossYield = BigInt(Math.floor(Math.random() * 10000) + 1) * 10n ** 6n;
        await vault.connect(owner).harvest(grossYield);
      }
      expect(await vault.yieldReserve()).to.be.gt(0);
    });

    it("Should revert on zero harvest", async function () {
      await expect(vault.connect(owner).harvest(0)).to.be.revertedWith("Zero yield");
    });

    it("Should handle extremely large harvest amounts", async function () {
      const hugeYield = ethers.parseUnits("1000000000", 6);
      await expect(vault.connect(owner).harvest(hugeYield)).to.not.be.reverted;
    });
  });
});