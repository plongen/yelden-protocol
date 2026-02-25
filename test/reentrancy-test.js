const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Yelden — Teste de Reentrância", function () {
  let vault, mockUSDC, attacker;
  let owner, attackerSigner;

  beforeEach(async function () {
    [owner, attackerSigner] = await ethers.getSigners();

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

    // Fund attacker
    await mockUSDC.mint(attackerSigner.address, ethers.parseUnits("10000", 6));
    
    // Deploy contrato atacante (AGORA VAI FUNCIONAR!)
    const Attacker = await ethers.getContractFactory("Attacker");
    attacker = await Attacker.deploy(await vault.getAddress());
    await attacker.waitForDeployment();
    
    // Fund attacker contract
    await mockUSDC.mint(await attacker.getAddress(), ethers.parseUnits("5000", 6));
    
    console.log("✅ Setup completo!");
  });

  it("Deve bloquear tentativa de reentrância", async function () {
    const attackAmount = ethers.parseUnits("1000", 6);
    
    // Aprova o vault para o contrato atacante
    await mockUSDC.connect(attackerSigner).approve(await vault.getAddress(), attackAmount);
    
    console.log("🔄 Tentando ataque de reentrância...");
    
    // Tenta atacar (deve falhar por causa do nonReentrant)
    await expect(
      attacker.connect(attackerSigner).attack(attackAmount)
    ).to.be.reverted;
    
    console.log("✅ Ataque bloqueado com sucesso!");
    
    // Verifica que o saldo do atacante não foi drenado
    const attackerBalance = await vault.balanceOf(attackerSigner.address);
    expect(attackerBalance).to.equal(0);
  });
});