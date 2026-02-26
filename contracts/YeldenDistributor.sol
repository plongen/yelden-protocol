// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IZKVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[3] memory publicInputs
    ) external view returns (bool);
}

/**
 * @title YeldenDistributor
 * @notice Receives surplus yield from YeldenVault and routes it to three pools:
 *         - Proportional pool (70%): distributed pro-rata to $YLD holders
 *         - Equalized pool (20%):    flat distribution with per-wallet cap
 *         - ZK bonus pool (10%):     claimed via ZK proof (human) or AI agent registry
 *           └─ AI agent sub-pool (5% of ZK pool): reserved for AIAgentRegistry
 * @dev ZK verification is stubbed — full Groth16 integration in v3 with ZKVerifier.sol.
 */
contract YeldenDistributor is Ownable {

    // ─── Constants ─────────────────────────────────────────────
    /// @notice Proportional tier — pro-rata by $YLD balance (70%)
    uint256 public constant PROPORTIONAL_BPS    = 7000;
    /// @notice Equalized tier — flat with per-wallet cap (20%)
    uint256 public constant EQUALIZED_BPS       = 2000;
    /// @notice ZK bonus pool — claimed via proof (10%)
    uint256 public constant ZK_BONUS_BPS        = 1000;
    /// @notice AI agent sub-pool as share of ZK bonus pool (5%)
    uint256 public constant AI_AGENT_SHARE_BPS  = 500;
    /// @notice Maximum USDC claimable per wallet per epoch (anti-whale)
    uint256 public constant WALLET_CAP          = 500e6;  // 500 USDC (6 decimals)
    /// @notice Basis points denominator
    uint256 public constant BASIS_POINTS        = 10000;

    // ─── State ─────────────────────────────────────────────────
    /// @notice Accumulated ZK bonus pool (human contributors)
    uint256 public zkBonusPool;

    /// @notice Accumulated AI agent reward pool
    uint256 public aiAgentPool;

    /// @notice Total surplus distributed to date
    uint256 public totalDistributed;

    /// @notice Optional ZK verifier — set in v3 for on-chain proof verification
    IZKVerifier public zkVerifier;

    /// @notice Authorized vault address — only vault can call distribute()
    address public vault;

    // ─── Events ────────────────────────────────────────────────
    event Distributed(
        uint256 proportional,
        uint256 equalized,
        uint256 zkPool,
        uint256 aiPool,
        uint256 timestamp
    );
    event ZKBonusClaimed(
        address indexed claimant,
        uint256 amount,
        uint256 category
    );
    event AIBonusClaimed(
        address indexed agent,
        uint256 amount
    );
    event VaultSet(address indexed oldVault, address indexed newVault);
    event ZKVerifierSet(address indexed oldVerifier, address indexed newVerifier);

    // ─── Constructor ───────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Modifiers ─────────────────────────────────────────────
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    // ─── Admin ─────────────────────────────────────────────────

    /**
     * @notice Set the authorized vault address.
     * @dev Only vault can call distribute(). Must be set before first harvest.
     * @param _vault Address of deployed YeldenVault
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault");
        emit VaultSet(vault, _vault);
        vault = _vault;
    }

    /**
     * @notice Set the ZK verifier contract for on-chain proof verification.
     * @dev Optional — when set, claimZKBonus requires a valid Groth16 proof.
     *      When not set, verification is skipped (testnet mode).
     * @param _zkVerifier Address of deployed ZKVerifier contract
     */
    function setZKVerifier(address _zkVerifier) external onlyOwner {
        emit ZKVerifierSet(address(zkVerifier), _zkVerifier);
        zkVerifier = IZKVerifier(_zkVerifier);
    }

    // ─── Distribution ──────────────────────────────────────────

    /**
     * @notice Receive surplus from YeldenVault and allocate to pools.
     * @dev Called automatically by YeldenVault.harvest().
     *      Only the authorized vault address can call this.
     * @param surplus Total distributable surplus in USDC terms
     */
    function distribute(uint256 surplus) external onlyVault {
        require(surplus > 0, "Zero surplus");

        uint256 proportional = (surplus * PROPORTIONAL_BPS) / BASIS_POINTS; // 70%
        uint256 equalized    = (surplus * EQUALIZED_BPS)    / BASIS_POINTS; // 20%
        uint256 zkPool       = (surplus * ZK_BONUS_BPS)     / BASIS_POINTS; // 10%

        uint256 aiShare = (zkPool * AI_AGENT_SHARE_BPS) / BASIS_POINTS; // 5% of ZK
        uint256 humanZK = zkPool - aiShare;

        aiAgentPool  += aiShare;
        zkBonusPool  += humanZK;
        totalDistributed += surplus;

        // proportional and equalized pools are tracked off-chain via events
        // on-chain distribution logic added in v3 with $YLD token integration

        emit Distributed(proportional, equalized, humanZK, aiShare, block.timestamp);
    }

    // ─── Claims ────────────────────────────────────────────────

    /**
     * @notice Claim a ZK bonus from the human contributor pool.
     * @dev When zkVerifier is set, the proof is verified on-chain.
     *      When zkVerifier is not set (testnet), verification is skipped.
     *      In production: proof encodes [category, score, nullifier] as public inputs.
     *      Nullifier prevents double-claiming — enforced in ZKVerifier.sol.
     * @param amount        Amount to claim from zkBonusPool
     * @param category      Contribution category (1=env, 2=oss, 3=community)
     * @param a             Groth16 proof component A
     * @param b             Groth16 proof component B
     * @param c             Groth16 proof component C
     * @param publicInputs  Public inputs: [category, score, nullifier]
     */
    function claimZKBonus(
        uint256 amount,
        uint256 category,
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[3] memory publicInputs
    ) external {
        require(amount > 0, "Zero amount");
        require(amount <= zkBonusPool, "Insufficient pool");
        require(amount <= WALLET_CAP, "Exceeds wallet cap");

        // On-chain ZK verification when verifier is deployed
        if (address(zkVerifier) != address(0)) {
            bool valid = zkVerifier.verifyProof(a, b, c, publicInputs);
            require(valid, "Invalid ZK proof");
        }

        zkBonusPool -= amount;

        emit ZKBonusClaimed(msg.sender, amount, category);
    }

    /**
     * @notice Claim AI agent reward from the aiAgentPool.
     * @dev In production, this is called by AIAgentRegistry after
     *      Chainlink DON validation. Currently callable by owner for testnet.
     * @param agent  Agent address to receive reward
     * @param amount Amount to release from aiAgentPool
     */
    function releaseAIBonus(address agent, uint256 amount) external onlyOwner {
        require(agent != address(0), "Invalid agent");
        require(amount > 0, "Zero amount");
        require(amount <= aiAgentPool, "Insufficient AI pool");

        aiAgentPool -= amount;

        emit AIBonusClaimed(agent, amount);
    }

    // ─── Views ─────────────────────────────────────────────────

    /**
     * @notice Returns total pool balances at a glance.
     * @return zkPool    Current ZK bonus pool balance
     * @return aiPool    Current AI agent pool balance
     * @return totalDist Total surplus distributed to date
     */
    function poolBalances()
        external
        view
        returns (uint256 zkPool, uint256 aiPool, uint256 totalDist)
    {
        return (zkBonusPool, aiAgentPool, totalDistributed);
    }
}
