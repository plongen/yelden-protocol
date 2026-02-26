const { ethers } = require("hardhat");

async function deployVaultOnly() {
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
  await mockUSDC.waitForDeployment();

  const YeldenVault = await ethers.getContractFactory("YeldenVault");
  const vault = await YeldenVault.deploy(
    await mockUSDC.getAddress(),
    "Yelden USD",
    "yUSD"
  );
  await vault.waitForDeployment();

  return { vault, usdc: mockUSDC };
}

async function deployConnected() {
  const { vault, usdc } = await deployVaultOnly();

  const YeldenDistributor = await ethers.getContractFactory("YeldenDistributor");
  const distributor = await YeldenDistributor.deploy();
  await distributor.waitForDeployment();

  // Configura o vault no distribuidor
  await distributor.setVault(await vault.getAddress());
  
  // Configura o distribuidor no vault
  await vault.setDistributor(await distributor.getAddress());

  return { vault, distributor, usdc };
}

async function deployWithVerifier() {
  const { vault, distributor, usdc } = await deployConnected();

  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const verifier = await ZKVerifier.deploy();
  await verifier.waitForDeployment();

  return { vault, distributor, usdc, verifier };
}

module.exports = {
  deployVaultOnly,
  deployConnected,
  deployWithVerifier
};