// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./YeldenVault.sol";
import "./YeldenDistributor.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public decimals = 6;
    uint256 public totalSupply;
    function mint(address to, uint256 a) external { balanceOf[to] += a; totalSupply += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { require(balanceOf[msg.sender] >= a); balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) { require(balanceOf[f] >= a); require(allowance[f][msg.sender] >= a); allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true; }
}

contract EchidnaSimple {
    YeldenVault internal vault;
    YeldenDistributor internal dist;
    MockUSDC internal usdc;

    constructor() {
        usdc = new MockUSDC();
        vault = new YeldenVault(IERC20(address(usdc)), "yUSD", "yUSD");
        dist = new YeldenDistributor();
        dist.setVault(address(vault));
        vault.setDistributor(address(dist));
        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(vault), 1_000_000_000e6);
    }

    function echidna_shares_backed() public view returns (bool) {
        uint256 s = vault.totalSupply();
        uint256 a = vault.totalAssets();
        return s == 0 || a > 0;
    }

    function echidna_no_inflation() public view returns (bool) {
        if (vault.totalSupply() == 0) return true;
        uint256 shares = vault.convertToShares(1000e6);
        if (shares == 0) return true;
        return vault.convertToAssets(shares) <= 1000e6;
    }

    function echidna_reserve_bounded() public view returns (bool) {
        return vault.yieldReserve() <= vault.totalAssets();
    }

    function do_deposit(uint256 amount) public {
        amount = 1e6 + (amount % 100_000e6);
        vault.deposit(amount, address(this));
    }

    function do_withdraw(uint256 amount) public {
        uint256 bal = vault.balanceOf(address(this));
        if (bal == 0) return;
        uint256 assets = vault.convertToAssets(bal);
        if (assets == 0) return;
        amount = 1 + (amount % assets);
        vault.withdraw(amount, address(this), address(this));
    }

    function do_harvest(uint256 amount) public {
        amount = 1e6 + (amount % 1_000_000e6);
        vault.harvest(amount);
    }
}
