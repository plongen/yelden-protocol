const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployConnected } = require("./helpers");

describe("Yelden — Teste de Reentrância", function () {
  let vault, distributor, mockUSDC, attacker;
  let owner, attackerSigner;

  beforeEach(async function () {
    [owner, attackerSigner] = await ethers.getSigners();

    const deployment = await deployConnected();
    vault = deployment.vault;
    distributor = deployment.distributor;
    mockUSDC = deployment.usdc;

    await mockUSDC.mint(attackerSigner.address, ethers.parseUnits("10000", 6));
    
    const Attacker = await ethers.getContractFactory("Attacker");
    attacker = await Attacker.deploy(await vault.getAddress());
    await attacker.waitForDeployment();
    
    await mockUSDC.mint(await attacker.getAddress(), ethers.parseUnits("5000", 6));
    
    console.log("✅ Setup completo!");
  });

  it("Deve bloquear tentativa de reentrância", async function () {
    const attackAmount = ethers.parseUnits("1000", 6);
    
    await mockUSDC.connect(attackerSigner).approve(await vault.getAddress(), attackAmount);
    
    console.log("🔄 Tentando ataque de reentrância...");
    
    await expect(
      attacker.connect(attackerSigner).attack(attackAmount)
    ).to.be.reverted;
    
    console.log("✅ Ataque bloqueado com sucesso!");
  });
});