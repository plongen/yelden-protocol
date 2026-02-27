const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Yelden — Mainnet Test (Rápido)", function () {
  let vault, usdc;
  let owner, user;

  const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WHALE = "0x28C6c06298d514Db089934071355E5743bf21d60";

  before(async function () {
    this.timeout(120000);
    
    console.log("🔄 Iniciando fork da mainnet...");
    await network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
          blockNumber: 19500000
        }
      }]
    });
    console.log("✅ Fork concluído!");

    console.log("🔄 Impersonando whale...");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WHALE]
    });
    console.log("✅ Whale impersonado!");
  });

  it("Deve depositar USDC real", async function () {
    this.timeout(60000);
    
    [owner, user] = await ethers.getSigners();
    
    usdc = await ethers.getContractAt("IERC20", USDC_MAINNET);
    const whale = await ethers.getSigner(WHALE);
    
    const amount = ethers.parseUnits("100", 6);
    
    console.log("🔄 Transferindo USDC do whale...");
    await usdc.connect(whale).transfer(user.address, amount);
    console.log("✅ Transferido!");
    
    const YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(USDC_MAINNET, "Yelden USD", "yUSD");
    await vault.waitForDeployment();
    console.log("✅ Vault deployado!");
    
    console.log("🔄 Aprovando USDC...");
    await usdc.connect(user).approve(await vault.getAddress(), amount);
    
    console.log("🔄 Depositando...");
    await vault.connect(user).deposit(amount, user.address);
    
    expect(await vault.balanceOf(user.address)).to.equal(amount);
    console.log("✅ Depósito concluído!");
  });

  after(async function () {
    this.timeout(30000);
    await network.provider.request({ method: "hardhat_reset", params: [] });
    console.log("✅ Fork finalizado!");
  });
});