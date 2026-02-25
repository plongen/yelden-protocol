const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YeldenVault", function () {
  let YeldenVault;
  let vault;
  let owner;
  let addr1;
  let addr2;
  let mockUSDC;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    
    // Deploy mock USDC (para testes)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    
    // Deploy vault
    YeldenVault = await ethers.getContractFactory("YeldenVault");
    vault = await YeldenVault.deploy(
      await mockUSDC.getAddress(),
      "Yelden USD",
      "yUSD"
    );
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right asset", async function () {
      expect(await vault.asset()).to.equal(await mockUSDC.getAddress());
    });

    it("Should have correct name and symbol", async function () {
      expect(await vault.name()).to.equal("Yelden USD");
      expect(await vault.symbol()).to.equal("yUSD");
    });
  });

  describe("Deposits", function () {
    it("Should deposit USDC and mint yUSD", async function () {
      // Mint some USDC to addr1
      await mockUSDC.mint(addr1.address, 1000);
      
      // Approve vault
      await mockUSDC.connect(addr1).approve(await vault.getAddress(), 1000);
      
      // Deposit
      await vault.connect(addr1).deposit(1000, addr1.address);
      
      // Check balances
      expect(await vault.balanceOf(addr1.address)).to.equal(1000);
      expect(await vault.totalAssets()).to.equal(1000);
    });
  });
});

// Mock ERC20 contract for testing
const MockERC20 = {
  deploy: async (name, symbol, decimals) => {
    const contract = await ethers.getContractFactory("MockERC20");
    return contract.deploy(name, symbol, decimals);
  }
};