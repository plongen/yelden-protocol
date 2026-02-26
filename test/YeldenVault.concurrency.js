const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployConnected } = require("./helpers");

describe("YeldenVault — Concurrency Testing", function () {
  let vault, distributor, mockUSDC;
  let users;

  const NUM_USERS = 10;
  const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);

  beforeEach(async function () {
    users = await ethers.getSigners();
    users = users.slice(0, NUM_USERS);

    const deployment = await deployConnected();
    vault = deployment.vault;
    mockUSDC = deployment.usdc;

    for (const user of users) {
      await mockUSDC.mint(user.address, ethers.parseUnits("100000", 6));
    }
  });

  describe("Concurrent Deposits", function () {
    it("Should handle 10 users depositing at the same time", async function () {
      const vaultAddress = await vault.getAddress();

      const approvalPromises = users.map(user =>
        mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT)
      );
      await Promise.all(approvalPromises);

      const depositPromises = users.map(user =>
        vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address)
      );
      await Promise.all(depositPromises);

      for (const user of users) {
        expect(await vault.balanceOf(user.address)).to.equal(DEPOSIT_AMOUNT);
      }
      expect(await vault.totalAssets()).to.equal(DEPOSIT_AMOUNT * BigInt(NUM_USERS));
    });
  });

  describe("Concurrent Withdrawals", function () {
    beforeEach(async function () {
      const vaultAddress = await vault.getAddress();
      const approvalPromises = users.map(user =>
        mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT)
      );
      await Promise.all(approvalPromises);

      const depositPromises = users.map(user =>
        vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address)
      );
      await Promise.all(depositPromises);
    });

    it("Should handle 10 users withdrawing at the same time", async function () {
      const usdcBalancesBefore = await Promise.all(
        users.map(user => mockUSDC.balanceOf(user.address))
      );

      const withdrawPromises = users.map(user =>
        vault.connect(user).withdraw(DEPOSIT_AMOUNT, user.address, user.address)
      );
      await Promise.all(withdrawPromises);

      for (let i = 0; i < users.length; i++) {
        expect(await vault.balanceOf(users[i].address)).to.equal(0);
        expect(await mockUSDC.balanceOf(users[i].address)).to.equal(
          usdcBalancesBefore[i] + DEPOSIT_AMOUNT
        );
      }

      expect(await vault.totalAssets()).to.equal(0);
    });
  });

  describe("Mixed Operations", function () {
    it("Should handle half depositing, half withdrawing simultaneously", async function () {
      const depositors = users.slice(0, 5);
      const withdrawers = users.slice(5, 10);
      const vaultAddress = await vault.getAddress();

      // Depositors deposit first
      await Promise.all(
        depositors.map(async user => {
          await mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT);
          await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
        })
      );

      // Withdrawers also deposit so they have something to withdraw
      await Promise.all(
        withdrawers.map(async user => {
          await mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT);
          await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
        })
      );

      const extraDeposit = DEPOSIT_AMOUNT / 2n;

      // Approve extra for depositors
      await Promise.all(
        depositors.map(user =>
          mockUSDC.connect(user).approve(vaultAddress, extraDeposit)
        )
      );

      // Mixed operations
      const mixedOps = [
        ...depositors.map(user => 
          vault.connect(user).deposit(extraDeposit, user.address)
        ),
        ...withdrawers.map(user =>
          vault.connect(user).withdraw(DEPOSIT_AMOUNT, user.address, user.address)
        )
      ];

      await Promise.all(mixedOps);

      // Verifications
      for (const user of depositors) {
        expect(await vault.balanceOf(user.address)).to.equal(
          DEPOSIT_AMOUNT + extraDeposit
        );
      }

      for (const user of withdrawers) {
        expect(await vault.balanceOf(user.address)).to.equal(0);
      }

      const totalExpected = (DEPOSIT_AMOUNT + extraDeposit) * BigInt(depositors.length);
      expect(await vault.totalAssets()).to.equal(totalExpected);
    });
  });

  describe("Concurrent Transfers", function () {
    beforeEach(async function () {
      const vaultAddress = await vault.getAddress();
      await Promise.all(
        users.map(async user => {
          await mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT);
          await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
        })
      );
    });

    it("Should handle circular transfers", async function () {
      const transferPromises = users.map((user, i) => {
        const nextIndex = (i + 1) % users.length;
        return vault.connect(user).transfer(users[nextIndex].address, DEPOSIT_AMOUNT / 2n);
      });

      await Promise.all(transferPromises);

      for (const user of users) {
        expect(await vault.balanceOf(user.address)).to.equal(DEPOSIT_AMOUNT);
      }
    });
  });

  describe("Concurrent Operations with Harvest", function () {
    it("Should handle deposits while owner harvests", async function () {
      const vaultAddress = await vault.getAddress();
      const [owner] = await ethers.getSigners();

      // Initial deposits
      await Promise.all(
        users.slice(0, 5).map(async user => {
          await mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT);
          return vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
        })
      );

      // Harvest and new deposits simultaneously
      const harvestPromise = vault.connect(owner).harvest(ethers.parseUnits("5000", 6));
      
      const newDeposits = users.slice(5, 8).map(async user => {
        await mockUSDC.connect(user).approve(vaultAddress, DEPOSIT_AMOUNT);
        return vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
      });

      await Promise.all([harvestPromise, ...newDeposits]);

      expect(await vault.yieldReserve()).to.be.gt(0);
    });
  });
});