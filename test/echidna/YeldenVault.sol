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
 * @dev Simplified ERC-4626 — does not inherit IERC4626 to keep implementation
 *      explicit and auditable. Full ERC-4626 compliance planned for v3.
 */
contract YeldenVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables ────────────────────────────────────────────
    /// @notice The underlying asset accepted by this vault (USDC)
    IERC20 public immutable asset;

    // ─── Constants ─────────────────────────────────────────────
    /// @notice Portion of gross yield rebased to yUSD holders (4.5%)
    uint256 public constant BASE_YIELD_BPS  = 450;
    /// @notice Liquid USDC reserve ratio — not deployed to RWA (10%)
    uint256 public constant RESERVE_BPS     = 1000;
    /// @notice Environmental regeneration fund allocation (5%)
    uint256 public constant REGEN_BPS       = 500;
    /// @notice Bear market Yield Reserve Fund allocation of surplus (20%)
    uint256 public constant YIELD_RESERVE_BPS = 2000;
    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS    = 10000;

    // ─── State ─────────────────────────────────────────────────
    /// @notice Accumulated bear market reserve in USDC terms
    uint256 public yieldReserve;

    /// @notice Timestamp of last harvest
    uint256 public lastHarvest;

    /// @notice Address of YeldenDistributor — receives surplus after reserve
    IYeldenDistributor public distributor;

    // ─── Events ────────────────────────────────────────────────
    event Deposit(
        address indexed caller,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Harvest(
        uint256 gross,
        uint256 base,
        uint256 regen,
        uint256 toReserve,
        uint256 toDistributor
    );
    event DistributorSet(address indexed oldDistributor, address indexed newDistributor);
    event ReserveWithdrawn(address indexed to, uint256 amount);

    // ─── Constructor ───────────────────────────────────────────
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(address(_asset) != address(0), "Invalid asset");
        asset = _asset;
        lastHarvest = block.timestamp;
    }

    // ─── Admin ─────────────────────────────────────────────────

    /**
     * @notice Set or update the YeldenDistributor address.
     * @dev Only callable by owner. Emits DistributorSet.
     * @param _distributor Address of the deployed YeldenDistributor contract
     */
    function setDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0), "Invalid distributor");
        emit DistributorSet(address(distributor), _distributor);
        distributor = IYeldenDistributor(_distributor);
    }

    /**
     * @notice Withdraw accumulated bear market reserve to a target address.
     * @dev Only callable by owner. Used during bear market to supplement yield.
     * @param to      Recipient address
     * @param amount  Amount of USDC to withdraw from reserve
     */
    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount <= yieldReserve, "Exceeds reserve");
        yieldReserve -= amount;
        asset.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    // ─── ERC-4626 Core ─────────────────────────────────────────

    /**
     * @notice Total USDC held by the vault (liquid + deployed to RWA).
     * @return Total assets under management
     */
    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /**
     * @notice Convert a USDC amount to yUSD shares at current exchange rate.
     * @param assets Amount of USDC to convert
     * @return shares Equivalent yUSD shares
     */
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total  = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return (assets * supply) / total;
    }

    /**
     * @notice Convert yUSD shares to USDC at current exchange rate.
     * @param shares Amount of yUSD to convert
     * @return assets Equivalent USDC amount
     */
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    /**
     * @notice Deposit USDC and mint yUSD shares to receiver.
     * @param assets   Amount of USDC to deposit
     * @param receiver Address to receive yUSD shares
     * @return shares  Amount of yUSD minted
     */
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
    }

    /**
     * @notice Withdraw USDC by specifying asset amount. Burns equivalent yUSD.
     * @param assets   Amount of USDC to withdraw
     * @param receiver Address to receive USDC
     * @param owner    Address whose yUSD shares are burned
     * @return shares  Amount of yUSD burned
     */
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
        require(shares <= balanceOf(owner), "Insufficient balance");

        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Redeem yUSD shares for USDC. ERC-4626 standard entry point.
     * @dev Complementary to withdraw() — input is shares, not assets.
     * @param shares   Amount of yUSD shares to redeem
     * @param receiver Address to receive USDC
     * @param owner    Address whose yUSD shares are burned
     * @return assets  Amount of USDC returned
     */
    function redeem(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        returns (uint256 assets)
    {
        require(shares > 0, "Zero shares");
        require(receiver != address(0), "Invalid receiver");
        require(owner != address(0), "Invalid owner");
        require(shares <= balanceOf(owner), "Insufficient balance");

        assets = convertToAssets(shares);
        require(assets > 0, "Zero assets");

        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ─── Yield Harvest ─────────────────────────────────────────

    /**
     * @notice Harvest RWA yield and distribute to protocol components.
     * @dev In production, grossYield is pulled from RWA adapters (Ondo, Centrifuge).
     *      Currently accepts grossYield as parameter for testnet simulation.
     *      Routing: 4.5% base rebase → yUSD, 5% regen fund,
     *               20% of surplus → Yield Reserve, remainder → YeldenDistributor.
     * @param grossYield Total yield harvested in USDC terms
     */
    function harvest(uint256 grossYield) external onlyOwner {
        require(grossYield > 0, "Zero yield");
        require(address(distributor) != address(0), "Distributor not set");

        uint256 base    = (grossYield * BASE_YIELD_BPS)  / BASIS_POINTS; // 4.5%
        uint256 regen   = (grossYield * REGEN_BPS)       / BASIS_POINTS; // 5%
        uint256 surplus = grossYield - base - regen;                      // ~90.5%

        uint256 toReserve     = (surplus * YIELD_RESERVE_BPS) / BASIS_POINTS; // 20%
        uint256 toDistributor = surplus - toReserve;                           // 80%

        yieldReserve += toReserve;

        // Route surplus to YeldenDistributor for UBI + ZK bonus allocation
        distributor.distribute(toDistributor);

        emit Harvest(grossYield, base, regen, toReserve, toDistributor);
        lastHarvest = block.timestamp;
    }
}
