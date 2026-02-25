// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YeldenVault
 * @notice ERC-4626 simplified vault for Yelden Protocol
 * @dev Accepts USDC deposits, mints yUSD shares
 */
contract YeldenVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    IERC20 public immutable asset;
    
    // Constants
    uint256 public constant BASE_YIELD_BPS = 450; // 4.5%
    uint256 public constant RESERVE_BPS = 1000;   // 10%
    uint256 public constant REGEN_BPS = 500;      // 5%
    uint256 public constant BASIS_POINTS = 10000;
    
    // Yield reserve for bear markets
    uint256 public yieldReserve;
    uint256 public lastHarvest;
    
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event Harvest(uint256 gross, uint256 base, uint256 regen, uint256 surplus);
    
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        asset = _asset;
        lastHarvest = block.timestamp;
    }
    
    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }
    
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return (assets * supply) / total;
    }
    
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }
    
    function deposit(uint256 assets, address receiver) 
        external 
        nonReentrant 
        returns (uint256 shares) 
    {
        require(assets > 0, "Zero deposit");
        require(receiver != address(0), "Invalid receiver");
        
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares");
        
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        
        emit Deposit(msg.sender, receiver, assets, shares);
        return shares;
    }
    
    function withdraw(uint256 assets, address receiver, address owner)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(assets > 0, "Zero withdraw");
        require(receiver != address(0), "Invalid receiver");
        require(owner != address(0), "Invalid owner");
        
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares");
        
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        
        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        return shares;
    }
    
    /**
     * @notice Simula harvest de RWAs (apenas owner para testes)
     */
    function harvest(uint256 grossYield) external onlyOwner {
        require(grossYield > 0, "Zero yield");
        
        uint256 base = (grossYield * BASE_YIELD_BPS) / BASIS_POINTS;
        uint256 regen = (grossYield * REGEN_BPS) / BASIS_POINTS;
        uint256 surplus = grossYield - base - regen;
        
        // 20% do surplus vai para Yield Reserve
        uint256 reserve = (surplus * 2000) / BASIS_POINTS;
        yieldReserve += reserve;
        surplus -= reserve;
        
        emit Harvest(grossYield, base, regen, surplus);
        
        // Aqui você chamaria YeldenDistributor
    }
}