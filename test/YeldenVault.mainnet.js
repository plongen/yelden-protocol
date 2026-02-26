const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YeldenVault — Mainnet Fork Tests", function () {
  let vault;
  let owner, user1;
  
  // Endereços reais da mainnet
  const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const ONDO_VAULT = "0x7D60E8F4F2DE5D7A3a6c4f5B6c7d8e9f0a1b2c3d"; // Exemplo
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  
  // Fork da mainnet no bloco recente
  before(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
            blockNumber: 19500000, // Bloco recente (ajuste conforme necessário)
          },
        },
      ],
    });
  });

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(
      USDC_MAINNET,
      "Yelden USD",
      "yUSD"
    );
    await vault.waitForDeployment();

    // Connect distributor so harvest() works
    const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
    const distributor = await YeldenDistributor.deploy();
    await distributor.waitForDeployment();
    await distributor.setVault(await vault.getAddress());
    await vault.setDistributor(await distributor.getAddress());

    // Impersonar conta com USDC real (ex: Binance hot wallet)
    const WHALE = "0x28C6c06298d514Db089934071355E5743bf21d60"; // Conta com muito USDC
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WHALE],
    });
    const whale = await ethers.getSigner(WHALE);
    
    // Transferir USDC para user1
    const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
    const amount = ethers.parseUnits("100000", 6);
    await usdc.connect(whale).transfer(user1.address, amount);
  });

  after(async function () {
    // Reset para não afetar outros testes
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 1: DEPÓSITO COM USDC REAL
  // ─────────────────────────────────────────────────────────────
  describe("Real USDC Deposits", function () {
    it("Should deposit real USDC and mint yUSD", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const depositAmount = ethers.parseUnits("5000", 6);
      
      const balanceBefore = await usdc.balanceOf(user1.address);
      expect(balanceBefore).to.be.gte(depositAmount);
      
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
      
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });

    it("Should handle multiple real USDC deposits", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const amount1 = ethers.parseUnits("3000", 6);
      const amount2 = ethers.parseUnits("7000", 6);
      
      await usdc.connect(user1).approve(await vault.getAddress(), amount1 + amount2);
      await vault.connect(user1).deposit(amount1, user1.address);
      await vault.connect(user1).deposit(amount2, user1.address);
      
      expect(await vault.balanceOf(user1.address)).to.equal(amount1 + amount2);
      expect(await vault.totalAssets()).to.equal(amount1 + amount2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 2: INTERAÇÃO COM PROTOCOLOS REAIS
  // ─────────────────────────────────────────────────────────────
  describe("Interaction with Real Protocols", function () {
    it("Should be able to interact with Uniswap V3", async function () {
      // Este teste mostra que o Yelden pode interoperar com outros protocolos
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const depositAmount = ethers.parseUnits("10000", 6);
      
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
      
      // yUSD pode ser usado em outros protocolos
      const yUSD = await ethers.getContractAt("IERC20", await vault.getAddress());
      
      // Exemplo: aprovar yUSD para Uniswap
      await yUSD.connect(user1).approve(UNISWAP_V3_FACTORY, depositAmount);
      
      expect(await yUSD.allowance(user1.address, UNISWAP_V3_FACTORY)).to.equal(depositAmount);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 3: SAQUE PARA USDC REAL
  // ─────────────────────────────────────────────────────────────
  describe("Real USDC Withdrawals", function () {
    beforeEach(async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const depositAmount = ethers.parseUnits("8000", 6);
      
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);
    });

    it("Should withdraw real USDC", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const withdrawAmount = ethers.parseUnits("4000", 6);
      
      const usdcBefore = await usdc.balanceOf(user1.address);
      
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
      
      expect(await usdc.balanceOf(user1.address)).to.equal(usdcBefore + withdrawAmount);
      expect(await vault.balanceOf(user1.address)).to.equal(withdrawAmount); // 8000 - 4000 = 4000
    });

    it("Should allow full withdrawal", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const fullAmount = await vault.balanceOf(user1.address);
      
      const usdcBefore = await usdc.balanceOf(user1.address);
      
      await vault.connect(user1).withdraw(fullAmount, user1.address, user1.address);
      
      expect(await usdc.balanceOf(user1.address)).to.equal(usdcBefore + fullAmount);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 4: PREÇOS REAIS E ORÁCULOS
  // ─────────────────────────────────────────────────────────────
  describe("Real Prices and Oracles", function () {
    it("Should interact with Chainlink price feeds", async function () {
      // Endereço do Chainlink ETH/USD na mainnet
      const CHAINLINK_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
      
      const priceFeed = await ethers.getContractAt(
        [
          "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
        ],
        CHAINLINK_ETH_USD
      );
      
      const [, answer] = await priceFeed.latestRoundData();
      console.log(`   ETH/USD atual: $${ethers.formatUnits(answer, 8)}`);
      
      expect(answer).to.be.gt(0);
    });

    it("Should get real token balances", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const weth = await ethers.getContractAt("IERC20", WETH);
      
      // Conta com WETH (Binance)
      const BINANCE_HOT = "0x28C6c06298d514Db089934071355E5743bf21d60";
      const wethBalance = await weth.balanceOf(BINANCE_HOT);
      
      console.log(`   WETH na Binance: ${ethers.formatEther(wethBalance)} WETH`);
      expect(wethBalance).to.be.gt(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 5: CENÁRIO COMPLETO COM ATIVOS REAIS
  // ─────────────────────────────────────────────────────────────
  describe("Complete Real-World Scenario", function () {
    it("Should execute full cycle with real USDC", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const depositAmount = ethers.parseUnits("15000", 6);
      
      console.log("\n🔄 Cenário completo com USDC real:");
      
      // 1. Aprovar
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      console.log(`   ✅ Approve: ${ethers.formatUnits(depositAmount, 6)} USDC`);
      
      // 2. Depositar
      await vault.connect(user1).deposit(depositAmount, user1.address);
      console.log(`   ✅ Deposit: ${ethers.formatUnits(depositAmount, 6)} USDC → yUSD`);
      
      // 3. Verificar saldo
      const yUSDBalance = await vault.balanceOf(user1.address);
      console.log(`   ✅ yUSD recebido: ${ethers.formatUnits(yUSDBalance, 6)} yUSD`);
      
      // 4. Simular harvest (owner)
      const grossYield = ethers.parseUnits("500", 6);
      await vault.connect(owner).harvest(grossYield);
      console.log(`   ✅ Harvest: ${ethers.formatUnits(grossYield, 6)} USDC yield`);
      
      // 5. Saque parcial
      const withdrawAmount = depositAmount / 2n;
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
      console.log(`   ✅ Withdraw: ${ethers.formatUnits(withdrawAmount, 6)} USDC de volta`);
      
      // 6. Verificações finais
      const finalUSDC = await usdc.balanceOf(user1.address);
      const finalyUSD = await vault.balanceOf(user1.address);
      
      console.log(`   📊 Final: ${ethers.formatUnits(finalUSDC, 6)} USDC, ${ethers.formatUnits(finalyUSD, 6)} yUSD`);
      
      expect(finalUSDC).to.be.gt(0);
      expect(finalyUSD).to.be.gt(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  TESTE 6: COMPORTAMENTO COM MÚLTIPLOS ATIVOS
  // ─────────────────────────────────────────────────────────────
  describe("Multi-Asset Behavior", function () {
    it("Should interact with WETH and USDC", async function () {
      const usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
      const weth = await ethers.getContractAt("IERC20", WETH);
      
      // Impersonar conta com WETH
      const WHALE = "0x28C6c06298d514Db089934071355E5743bf21d60";
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [WHALE],
      });
      const whale = await ethers.getSigner(WHALE);
      
      const wethAmount = ethers.parseEther("10");
      await weth.connect(whale).transfer(user1.address, wethAmount);
      
      console.log(`   WETH transferido: ${ethers.formatEther(wethAmount)} WETH`);
      
      // Yelden só aceita USDC por enquanto, mas testamos que WETH não interfere
      const usdcAmount = ethers.parseUnits("5000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), usdcAmount);
      await vault.connect(user1).deposit(usdcAmount, user1.address);
      
      expect(await vault.balanceOf(user1.address)).to.equal(usdcAmount);
    });
  });
});