// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YeldenVault
 * @notice ERC-4626 vault com proteção contra bear market via Yield Reserve
 */
contract YeldenVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    IERC20 public immutable asset;
    
    // Constantes
    uint256 public constant BASE_YIELD_BPS = 450; // 4.5%
    uint256 public constant RESERVE_BPS = 1000;   // 10% liquidez
    uint256 public constant REGEN_BPS = 500;      // 5% fundo ambiental
    uint256 public constant SURPLUS_RESERVE_BPS = 2000; // 20% do surplus vai para reserve
    uint256 public constant BASIS_POINTS = 10000;
    
    // Yield reserve para bear markets
    uint256 public yieldReserve;
    uint256 public lastHarvest;
    
    // Controle de emergência
    bool public emergencyMode;
    uint256 public emergencyBaseYield; // Yield base reduzido durante emergência
    
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event Harvest(uint256 gross, uint256 base, uint256 regen, uint256 surplus, uint256 reserveAdded);
    event ReserveUsed(uint256 amount, string reason);
    event EmergencyModeSet(bool enabled, uint256 newBaseYield);
    
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        asset = _asset;
        lastHarvest = block.timestamp;
        emergencyBaseYield = BASE_YIELD_BPS; // Inicia igual ao normal
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
     * @notice Harvest yield dos RWAs
     * @param grossYield Yield bruto gerado
     */
    function harvest(uint256 grossYield) external onlyOwner {
        require(grossYield > 0, "Zero yield");
        
        uint256 base = (grossYield * BASE_YIELD_BPS) / BASIS_POINTS;
        uint256 regen = (grossYield * REGEN_BPS) / BASIS_POINTS;
        uint256 surplus = grossYield - base - regen;
        
        // 20% do surplus vai para Yield Reserve
        uint256 reserve = (surplus * SURPLUS_RESERVE_BPS) / BASIS_POINTS;
        yieldReserve += reserve;
        surplus -= reserve;
        
        emit Harvest(grossYield, base, regen, surplus, reserve);
        
        // Aqui você distribuiria o surplus para YeldenDistributor
        // (chamada externa seria adicionada)
    }
    
    /**
     * @notice Usa a reserva para complementar yield base em anos ruins
     * @param amount Quantidade a ser usada da reserva
     */
    function useReserve(uint256 amount) external onlyOwner {
        require(amount <= yieldReserve, "Reserve insufficient");
        require(amount > 0, "Zero amount");
        
        yieldReserve -= amount;
        
        // Em vez de transferir, registramos que a reserva foi usada
        // O valor será utilizado para complementar o yield base
        // via lógica externa (ex: YeldenDistributor)
        
        emit ReserveUsed(amount, "Bear market supplement");
    }
    
    /**
     * @notice Ativa modo de emergência com yield base reduzido
     * @param enabled Ativar/desativar modo emergência
     * @param newBaseYield Novo base yield em BPS (ex: 300 = 3.0%)
     */
    function setEmergencyMode(bool enabled, uint256 newBaseYield) external onlyOwner {
        emergencyMode = enabled;
        if (enabled) {
            require(newBaseYield > 0 && newBaseYield < BASE_YIELD_BPS, "Invalid base yield");
            emergencyBaseYield = newBaseYield;
        } else {
            emergencyBaseYield = BASE_YIELD_BPS;
        }
        emit EmergencyModeSet(enabled, emergencyBaseYield);
    }
    
    /**
     * @notice Retorna o base yield atual (considerando emergência)
     */
    function getCurrentBaseYield() public view returns (uint256) {
        return emergencyMode ? emergencyBaseYield : BASE_YIELD_BPS;
    }
    
    /**
     * @notice Função para simular uso da reserva em testes
     */
    function testUseReserve(uint256 amount) external onlyOwner {
        require(amount <= yieldReserve, "Reserve insufficient");
        yieldReserve -= amount;
        emit ReserveUsed(amount, "Test simulation");
    }
}