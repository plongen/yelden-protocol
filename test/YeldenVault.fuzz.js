const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YeldenVault — Fuzz Testing", function () {
  let vault, mockUSDC;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

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

    // Fund users with large balances
    await mockUSDC.mint(addr1.address, ethers.parseUnits("10000000", 6));
    await mockUSDC.mint(addr2.address, ethers.parseUnits("10000000", 6));
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 1: DEPÓSITOS COM VALORES ALEATÓRIOS
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Random Deposits", function () {
    it("Should handle 100 random deposit amounts", async function () {
      let totalDeposited = 0n;
      
      for (let i = 0; i < 100; i++) {
        // Gera valor aleatório entre 1 e 10.000 USDC
        const amount = BigInt(Math.floor(Math.random() * 10000) + 1) * 10n ** 6n;
        
        await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
        await vault.connect(addr1).deposit(amount, addr1.address);
        
        totalDeposited += amount;
        
        // Verifica a cada iteração se o totalAssets está correto
        expect(await vault.totalAssets()).to.equal(totalDeposited);
      }
      
      // Saldo final do usuário deve ser a soma de todos os depósitos
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
        
        // Verifica totais
        expect(await vault.totalAssets()).to.equal(totalDeposited);
        expect(await vault.balanceOf(user.address)).to.equal(userBalances[user.address]);
      }
      
      // Verifica balanços finais
      expect(await vault.balanceOf(addr1.address)).to.equal(userBalances[addr1.address]);
      expect(await vault.balanceOf(addr2.address)).to.equal(userBalances[addr2.address]);
    });

    it("Should handle deposits of 1 wei (minimum possible)", async function () {
      const amount = 1n; // 1 wei
      
      await mockUSDC.mint(addr1.address, amount);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), amount);
      await vault.connect(addr1).deposit(amount, addr1.address);
      
      expect(await vault.balanceOf(addr1.address)).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
    });

    it("Should handle deposits near uint256 max (expect revert)", async function () {
      const hugeAmount = ethers.MaxUint256 - 1000n;
      
      // Não temos saldo suficiente, então deve reverter
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), hugeAmount);
      await expect(
        vault.connect(addr1).deposit(hugeAmount, addr1.address)
      ).to.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 2: SAQUES ALEATÓRIOS APÓS DEPÓSITOS
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Random Withdrawals", function () {
    beforeEach(async function () {
      // Prepara o vault com depósitos iniciais
      const deposit1 = ethers.parseUnits("10000", 6);
      const deposit2 = ethers.parseUnits("20000", 6);
      
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), deposit1);
      await vault.connect(addr1).deposit(deposit1, addr1.address);
      
      await mockUSDC.connect(addr2).approve(await vault.getAddress(), deposit2);
      await vault.connect(addr2).deposit(deposit2, addr2.address);
    });

    it("Should handle 50 random withdrawals", async function () {
      const user1InitialBalance = await vault.balanceOf(addr1.address);
      const user2InitialBalance = await vault.balanceOf(addr2.address);
      const totalInitialAssets = await vault.totalAssets();
      
      for (let i = 0; i < 50; i++) {
        const user = i % 2 === 0 ? addr1 : addr2;
        const maxWithdraw = await vault.balanceOf(user.address);
        
        if (maxWithdraw === 0n) continue;
        
        // Gera valor aleatório entre 1 e o saldo máximo
        const withdrawAmount = BigInt(
          Math.floor(Math.random() * Number(maxWithdraw / 10n ** 6n)) + 1
        ) * 10n ** 6n;
        
        if (withdrawAmount > maxWithdraw) continue;
        
        const userBalanceBefore = await mockUSDC.balanceOf(user.address);
        
        await vault.connect(user).withdraw(withdrawAmount, user.address, user.address);
        
        // Verifica se o saldo USDC aumentou
        expect(await mockUSDC.balanceOf(user.address)).to.equal(
          userBalanceBefore + withdrawAmount
        );
      }
      
      // Verifica integridade dos totais
      const finalUser1Balance = await vault.balanceOf(addr1.address);
      const finalUser2Balance = await vault.balanceOf(addr2.address);
      const finalTotalAssets = await vault.totalAssets();
      
      expect(finalUser1Balance + finalUser2Balance).to.equal(finalTotalAssets);
      expect(finalTotalAssets).to.be.lessThanOrEqual(totalInitialAssets);
    });

    it("Should allow withdrawal of entire balance", async function () {
      const userBalance = await vault.balanceOf(addr1.address);
      const usdcBalanceBefore = await mockUSDC.balanceOf(addr1.address);
      
      await vault.connect(addr1).withdraw(userBalance, addr1.address, addr1.address);
      
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
      expect(await mockUSDC.balanceOf(addr1.address)).to.equal(
        usdcBalanceBefore + userBalance
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 3: HARVEST COM VALORES ALEATÓRIOS
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Random Harvest", function () {
    beforeEach(async function () {
      const deposit = ethers.parseUnits("50000", 6);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), deposit);
      await vault.connect(addr1).deposit(deposit, addr1.address);
    });

    it("Should handle 100 random harvest amounts", async function () {
      let totalReserve = 0n;
      
      for (let i = 0; i < 100; i++) {
        // Gera yield aleatório entre 1 e 10.000 USDC
        const grossYield = BigInt(Math.floor(Math.random() * 10000) + 1) * 10n ** 6n;
        
        await vault.harvest(grossYield);
        
        // Calcula o reserve esperado
        const base = (grossYield * 450n) / 10000n;
        const regen = (grossYield * 500n) / 10000n;
        const surplus = grossYield - base - regen;
        const reserve = (surplus * 2000n) / 10000n;
        totalReserve += reserve;
        
        // Verifica se o reserve acumulado está correto
        expect(await vault.yieldReserve()).to.equal(totalReserve);
      }
    });

    it("Should revert on zero harvest", async function () {
      await expect(vault.harvest(0)).to.be.revertedWith("Zero yield");
    });

    it("Should handle extremely large harvest amounts", async function () {
      const hugeYield = ethers.parseUnits("1000000000", 6); // 1B USDC
      
      // Mesmo com yield enorme, o cálculo deve funcionar sem overflow
      await expect(vault.harvest(hugeYield)).to.not.be.reverted;
      
      const reserve = await vault.yieldReserve();
      expect(reserve).to.be.gt(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 4: CONVERSÃO DE SHARES
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Share Conversion", function () {
    beforeEach(async function () {
      // Faz alguns depósitos para criar shares não-1:1
      const deposit1 = ethers.parseUnits("7777", 6);
      const deposit2 = ethers.parseUnits("12345", 6);
      
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), deposit1);
      await vault.connect(addr1).deposit(deposit1, addr1.address);
      
      await mockUSDC.connect(addr2).approve(await vault.getAddress(), deposit2);
      await vault.connect(addr2).deposit(deposit2, addr2.address);
    });

    it("convertToShares and convertToAssets should be inverse", async function () {
      for (let i = 0; i < 50; i++) {
        const assets = BigInt(Math.floor(Math.random() * 10000) + 1) * 10n ** 6n;
        
        const shares = await vault.convertToShares(assets);
        const backToAssets = await vault.convertToAssets(shares);
        
        // Pode haver pequenas diferenças devido a arredondamento
        const diff = backToAssets > assets ? backToAssets - assets : assets - backToAssets;
        expect(diff).to.be.lessThan(10n); // Tolerância de 10 wei
      }
    });

    it("Should handle zero values", async function () {
      expect(await vault.convertToShares(0)).to.equal(0);
      expect(await vault.convertToAssets(0)).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 5: CENÁRIOS CAÓTICOS (DEPÓSITOS + SAQUES + HARVEST)
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Chaotic Scenarios", function () {
    it("Should survive 100 random operations", async function () {
      const users = [addr1, addr2];
      const userBalances = { [addr1.address]: 0n, [addr2.address]: 0n };
      let totalReserve = 0n;
      
      for (let i = 0; i < 100; i++) {
        const operation = Math.floor(Math.random() * 4); // 0-3
        
        if (operation === 0) { // DEPOSIT
          const user = users[Math.floor(Math.random() * users.length)];
          const amount = BigInt(Math.floor(Math.random() * 5000) + 1) * 10n ** 6n;
          
          await mockUSDC.connect(user).approve(await vault.getAddress(), amount);
          await vault.connect(user).deposit(amount, user.address);
          
          userBalances[user.address] += amount;
          
        } else if (operation === 1) { // WITHDRAW
          const user = users[Math.floor(Math.random() * users.length)];
          const maxWithdraw = userBalances[user.address];
          
          if (maxWithdraw > 0) {
            const withdrawAmount = BigInt(
              Math.floor(Math.random() * Number(maxWithdraw / 10n ** 6n)) + 1
            ) * 10n ** 6n;
            
            if (withdrawAmount <= maxWithdraw) {
              await vault.connect(user).withdraw(withdrawAmount, user.address, user.address);
              userBalances[user.address] -= withdrawAmount;
            }
          }
          
        } else if (operation === 2) { // HARVEST
          const grossYield = BigInt(Math.floor(Math.random() * 2000) + 100) * 10n ** 6n;
          await vault.harvest(grossYield);
          
          const base = (grossYield * 450n) / 10000n;
          const regen = (grossYield * 500n) / 10000n;
          const surplus = grossYield - base - regen;
          const reserve = (surplus * 2000n) / 10000n;
          totalReserve += reserve;
          
        } else { // TRANSFER (entre usuários)
          const from = users[Math.floor(Math.random() * users.length)];
          const to = users[Math.floor(Math.random() * users.length)];
          
          if (from !== to) {
            const maxTransfer = userBalances[from.address];
            if (maxTransfer > 0) {
              const transferAmount = BigInt(
                Math.floor(Math.random() * Number(maxTransfer / 10n ** 6n)) + 1
              ) * 10n ** 6n;
              
              if (transferAmount <= maxTransfer) {
                await vault.connect(from).transfer(to.address, transferAmount);
                userBalances[from.address] -= transferAmount;
                userBalances[to.address] += transferAmount;
              }
            }
          }
        }
        
        // A cada 10 operações, verifica a consistência do sistema
        if (i % 10 === 0) {
          const totalShares = userBalances[addr1.address] + userBalances[addr2.address];
          expect(await vault.totalSupply()).to.equal(totalShares);
          
          const totalAssets = await vault.totalAssets();
          expect(totalAssets).to.be.gte(0);
        }
      }
      
      // Verificação final
      const totalShares = userBalances[addr1.address] + userBalances[addr2.address];
      expect(await vault.totalSupply()).to.equal(totalShares);
      expect(await vault.yieldReserve()).to.equal(totalReserve);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  FUZZ 6: VALORES EXTREMOS E BORDAS
  // ─────────────────────────────────────────────────────────────
  describe("Fuzz — Edge Cases", function () {
    it("Should handle deposit of 1 wei and then withdraw", async function () {
      const tinyAmount = 1n;
      
      await mockUSDC.mint(addr1.address, tinyAmount);
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), tinyAmount);
      await vault.connect(addr1).deposit(tinyAmount, addr1.address);
      
      expect(await vault.balanceOf(addr1.address)).to.equal(tinyAmount);
      
      await vault.connect(addr1).withdraw(tinyAmount, addr1.address, addr1.address);
      expect(await vault.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should handle multiple tiny deposits", async function () {
      let total = 0n;
      
      for (let i = 0; i < 100; i++) {
        const tinyAmount = 1n + BigInt(i); // 1, 2, 3, ... 100 wei
        total += tinyAmount;
        
        await mockUSDC.mint(addr1.address, tinyAmount);
        await mockUSDC.connect(addr1).approve(await vault.getAddress(), tinyAmount);
        await vault.connect(addr1).deposit(tinyAmount, addr1.address);
      }
      
      expect(await vault.balanceOf(addr1.address)).to.equal(total);
      expect(await vault.totalAssets()).to.equal(total);
    });

    it("Should handle maximum possible deposit without overflow", async function () {
      // Encontra o maior depósito possível sem estourar o saldo do mock
      const maxUserBalance = await mockUSDC.balanceOf(addr1.address);
      
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), maxUserBalance);
      await vault.connect(addr1).deposit(maxUserBalance, addr1.address);
      
      expect(await vault.balanceOf(addr1.address)).to.equal(maxUserBalance);
    });
  });
});