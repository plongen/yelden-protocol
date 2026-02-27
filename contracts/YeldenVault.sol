// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IYeldenDistributor {
    function distribute(uint256 surplus) external;
}

/**
 * @title YeldenVault
 * @notice ERC-4626 compliant vault for Yelden Protocol.
 *         Accepts USDC deposits, mints yUSD shares 1:1.
 *         Harvests RWA yield and routes surplus to YeldenDistributor.
 *         Receives slashed stake from AIAgentRegistry into yieldReserve.
 */
contract YeldenVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables ───────────────────────────────────────────────────────────
    IERC20 public immutable asset;

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant BASE_YIELD_BPS    = 450;
    uint256 public constant RESERVE_BPS       = 1000;
    uint256 public constant REGEN_BPS         = 500;
    uint256 public constant YIELD_RESERVE_BPS = 2000;
    uint256 public constant BASIS_POINTS      = 10000;

    // ─── State ────────────────────────────────────────────────────────────────
    uint256 public yieldReserve;
    uint256 public lastHarvest;

    IYeldenDistributor public distributor;

    /// @notice AIAgentRegistry — only address allowed to call receiveSlash()
    address public registry;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event Harvest(uint256 gross, uint256 base, uint256 regen, uint256 toReserve, uint256 toDistributor);
    event DistributorSet(address indexed oldDistributor, address indexed newDistributor);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event RegistrySet(address indexed oldRegistry, address indexed newRegistry);
    event SlashReceived(uint256 amount, uint256 newReserve);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(address(_asset) != address(0), "Invalid asset");
        asset = _asset;
        lastHarvest = block.timestamp;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0), "Invalid distributor");
        emit DistributorSet(address(distributor), _distributor);
        distributor = IYeldenDistributor(_distributor);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        emit RegistrySet(registry, _registry);
        registry = _registry;
    }

    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount <= yieldReserve, "Exceeds reserve");
        yieldReserve -= amount;
        asset.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    // ─── Slash Integration ────────────────────────────────────────────────────

    /**
     * @notice Receive slashed stake from AIAgentRegistry.
     *         USDC is already transferred — this function just accounts it.
     *         Only callable by the registered AIAgentRegistry.
     * @param amount Amount of slashed USDC added to yieldReserve
     */
    function receiveSlash(uint256 amount) external {
        require(msg.sender == registry, "Vault: caller is not registry");
        require(amount > 0, "Vault: zero slash amount");
        yieldReserve += amount;
        emit SlashReceived(amount, yieldReserve);
    }

    // ─── ERC-4626 Core ────────────────────────────────────────────────────────

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total  = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return (assets * supply) / total;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    function deposit(uint256 assets, address receiver)
        external nonReentrant returns (uint256 shares)
    {
        require(assets > 0, "Zero deposit");
        require(receiver != address(0), "Invalid receiver");
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares");
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        external nonReentrant returns (uint256 shares)
    {
        require(assets > 0, "Zero withdraw");
        require(receiver != address(0), "Invalid receiver");
        require(owner != address(0), "Invalid owner");
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares");
        require(shares <= balanceOf(owner), "Insufficient balance");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner)
        external nonReentrant returns (uint256 assets)
    {
        require(shares > 0, "Zero shares");
        require(receiver != address(0), "Invalid receiver");
        require(owner != address(0), "Invalid owner");
        require(shares <= balanceOf(owner), "Insufficient balance");
        assets = convertToAssets(shares);
        require(assets > 0, "Zero assets");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ─── Yield Harvest ────────────────────────────────────────────────────────

    function harvest(uint256 grossYield) external onlyOwner {
        require(grossYield > 0, "Zero yield");
        require(address(distributor) != address(0), "Distributor not set");

        uint256 base    = (grossYield * BASE_YIELD_BPS)  / BASIS_POINTS;
        uint256 regen   = (grossYield * REGEN_BPS)       / BASIS_POINTS;
        uint256 surplus = grossYield - base - regen;

        uint256 toReserve     = (surplus * YIELD_RESERVE_BPS) / BASIS_POINTS;
        uint256 toDistributor = surplus - toReserve;

        yieldReserve += toReserve;
        distributor.distribute(toDistributor);

        emit Harvest(grossYield, base, regen, toReserve, toDistributor);
        lastHarvest = block.timestamp;
    }
}
