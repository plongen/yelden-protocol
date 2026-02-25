const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Yelden Protocol...");

  // Endereço do USDC na Sepolia (ou mainnet)
  // Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  
  console.log(`📦 Using USDC at: ${USDC_ADDRESS}`);
  
  const YeldenVault = await hre.ethers.getContractFactory("YeldenVault");
  const vault = await YeldenVault.deploy(
    USDC_ADDRESS,
    "Yelden USD",
    "yUSD"
  );

  await vault.waitForDeployment();
  
  const vaultAddress = await vault.getAddress();
  console.log(`✅ YeldenVault deployed to: ${vaultAddress}`);
  
  // Verificar no Etherscan (se tiver API key)
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying on Etherscan...");
    await hre.run("verify:verify", {
      address: vaultAddress,
      constructorArguments: [USDC_ADDRESS, "Yelden USD", "yUSD"],
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});