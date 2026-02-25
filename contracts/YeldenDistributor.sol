// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract YeldenDistributor is Ownable {
    uint256 public constant PROPORTIONAL_BPS = 7000; // 70%
    uint256 public constant EQUALIZED_BPS = 2000;    // 20%
    uint256 public constant ZK_BONUS_BPS = 1000;     // 10%
    uint256 public constant AI_AGENT_SHARE_BPS = 500; // 5% do pool ZK

    uint256 public zkBonusPool;
    uint256 public aiAgentPool;

    // ✅ CONSTRUTOR CORRETO: chama Ownable com o endereço de quem implantar
    constructor() Ownable(msg.sender) {}

    event Distributed(uint256 proportional, uint256 equalized, uint256 zkPool, uint256 timestamp);
    event ZKBonusClaimed(address indexed claimant, uint256 amount, uint256 category);

    function distribute(uint256 surplus) external onlyOwner {
        uint256 proportional = (surplus * PROPORTIONAL_BPS) / 10000;
        uint256 equalized = (surplus * EQUALIZED_BPS) / 10000;
        uint256 zkPool = (surplus * ZK_BONUS_BPS) / 10000;

        uint256 aiShare = (zkPool * AI_AGENT_SHARE_BPS) / 10000;
        aiAgentPool += aiShare;
        zkBonusPool += (zkPool - aiShare);

        emit Distributed(proportional, equalized, zkPool, block.timestamp);
    }

    function claimZKBonus(uint256 amount, uint256 category) external {
        require(amount > 0, "Zero amount");
        require(zkBonusPool >= amount, "Insufficient pool");

        zkBonusPool -= amount;
        // Em produção, teria verificação ZK aqui

        emit ZKBonusClaimed(msg.sender, amount, category);
    }
}