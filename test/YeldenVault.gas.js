const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployConnected } = require("./helpers");

describe("YeldenVault — Gas Consumption", function () {
  let vault, distributor, mockUSDC;
  let owner, user1, user2;

  const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
  const GROSS_YIELD = ethers.parseUnits("5000", 6);

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const deployment = await deployConnected();
    vault = deployment.vault;
    mockUSDC = deployment.usdc;

    await mockUSDC.mint(user1.address, ethers.parseUnits("100000", 6));
    await mockUSDC.mint(user2.address, ethers.parseUnits("100000", 6));
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: DEPÓSITOS
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Deposits", function () {
    it("Records gas for first deposit", async function () {
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      
      const tx = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const receipt = await tx.wait();
      
      console.log(`⛽ First deposit: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(150000); // Limite seguro
    });

    it("Records gas for second deposit (different user)", async function () {
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      await mockUSDC.connect(user2).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      const tx = await vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address);
      const receipt = await tx.wait();
      
      console.log(`⛽ Second deposit: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(100000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: SAQUES
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Withdrawals", function () {
    beforeEach(async function () {
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Records gas for full withdrawal", async function () {
      const tx = await vault.connect(user1).withdraw(DEPOSIT_AMOUNT, user1.address, user1.address);
      const receipt = await tx.wait();
      
      console.log(`⛽ Full withdrawal: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(100000);
    });

    it("Records gas for partial withdrawal", async function () {
      const partial = DEPOSIT_AMOUNT / 2n;
      
      const tx = await vault.connect(user1).withdraw(partial, user1.address, user1.address);
      const receipt = await tx.wait();
      
      console.log(`⛽ Partial withdrawal: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(100000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: HARVEST
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Harvest", function () {
    beforeEach(async function () {
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Records gas for harvest", async function () {
      const tx = await vault.connect(owner).harvest(GROSS_YIELD);
      const receipt = await tx.wait();
      
      console.log(`⛽ Harvest: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(200000); // Higher due to distributor call
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: TRANSFERÊNCIAS
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Transfers", function () {
    beforeEach(async function () {
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Records gas for transfer", async function () {
      const transferAmount = DEPOSIT_AMOUNT / 2n;
      
      const tx = await vault.connect(user1).transfer(user2.address, transferAmount);
      const receipt = await tx.wait();
      
      console.log(`⛽ Transfer: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(80000);
    });

    it("Records gas for transferFrom (approved)", async function () {
      const transferAmount = DEPOSIT_AMOUNT / 2n;
      
      await vault.connect(user1).approve(user2.address, transferAmount);
      const tx = await vault.connect(user2).transferFrom(user1.address, user2.address, transferAmount);
      const receipt = await tx.wait();
      
      console.log(`⛽ TransferFrom: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(80000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: APROVAÇÕES
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Approvals", function () {
    it("Records gas for approve", async function () {
      const tx = await vault.connect(user1).approve(user2.address, DEPOSIT_AMOUNT);
      const receipt = await tx.wait();
      
      console.log(`⛽ Approve: ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lessThan(50000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: COMPARAÇÕES
  // ─────────────────────────────────────────────────────────────
  describe("Gas Comparisons", function () {
    it("Compares deposit vs withdraw costs", async function () {
      // Deposit
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      const depositTx = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const depositReceipt = await depositTx.wait();
      
      // Withdraw
      const withdrawTx = await vault.connect(user1).withdraw(DEPOSIT_AMOUNT / 2n, user1.address, user1.address);
      const withdrawReceipt = await withdrawTx.wait();
      
      console.log(`\n📊 Gas Comparison:`);
      console.log(`   Deposit:  ${depositReceipt.gasUsed} gas`);
      console.log(`   Withdraw: ${withdrawReceipt.gasUsed} gas`);
      console.log(`   Ratio:    ${(Number(depositReceipt.gasUsed) / Number(withdrawReceipt.gasUsed)).toFixed(2)}x`);
    });

    it("Measures gas increase with vault growth", async function () {
      // Primeiro depósito (vazio)
      await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      const tx1 = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const receipt1 = await tx1.wait();
      
      // Segundo depósito (vault já tem fundos)
      await mockUSDC.connect(user2).approve(await vault.getAddress(), DEPOSIT_AMOUNT * 2n);
      const tx2 = await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n, user2.address);
      const receipt2 = await tx2.wait();
      
      console.log(`\n📈 Gas vs TVL:`);
      console.log(`   Deposit (TVL 0): ${receipt1.gasUsed} gas`);
      console.log(`   Deposit (TVL ${ethers.formatUnits(await vault.totalAssets(), 6)} USDC): ${receipt2.gasUsed} gas`);
      console.log(`   Difference: ${Number(receipt2.gasUsed) - Number(receipt1.gasUsed)} gas`);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  GAS: CENÁRIOS REALISTAS
  // ─────────────────────────────────────────────────────────────
  describe("Gas — Realistic Scenarios", function () {
    it("Simulates user journey: approve → deposit → harvest → withdraw", async function () {
      console.log(`\n🔄 Simulating user journey:`);
      
      // Approve
      let tx = await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      let receipt = await tx.wait();
      console.log(`   ✅ Approve: ${receipt.gasUsed} gas`);
      
      // Deposit
      tx = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      receipt = await tx.wait();
      console.log(`   ✅ Deposit:  ${receipt.gasUsed} gas`);
      
      // Harvest (owner)
      tx = await vault.connect(owner).harvest(GROSS_YIELD);
      receipt = await tx.wait();
      console.log(`   ✅ Harvest:  ${receipt.gasUsed} gas (owner)`);
      
      // Withdraw
      tx = await vault.connect(user1).withdraw(DEPOSIT_AMOUNT / 2n, user1.address, user1.address);
      receipt = await tx.wait();
      console.log(`   ✅ Withdraw: ${receipt.gasUsed} gas`);
      
      // Sequential — each tx must confirm before next (approve before deposit)
      const tx_a = await mockUSDC.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      const r_a = await tx_a.wait();
      const tx_d = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const r_d = await tx_d.wait();
      const tx_h = await vault.connect(owner).harvest(GROSS_YIELD);
      const r_h = await tx_h.wait();
      const tx_w = await vault.connect(user1).withdraw(DEPOSIT_AMOUNT / 2n, user1.address, user1.address);
      const r_w = await tx_w.wait();
      const sum = [r_a, r_d, r_h, r_w].reduce((acc, r) => acc + Number(r.gasUsed), 0);
      console.log(`\n   Total gas: ${sum} gas (~$${(sum * 20 * 1e-9 * 3000).toFixed(2)} USD @ 20 gwei / $3000 ETH)`);
    });
  });
});