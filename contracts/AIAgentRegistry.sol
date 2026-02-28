// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AIAgentRegistry
 * @notice On-chain reputation registry for autonomous AI agents.
 *
 * STAKE MODEL:
 *   - Entry stake: 50 YLD (fixed, subject to slashing)
 *   - Monthly fee: monthlyFee * (1000 - score) / 1000
 *     → score 1000 = 0 YLD/month (perfect agent pays nothing)
 *     → score 500  = 0.5 YLD/month
 *     → score 0    = full monthlyFee/month
 *   - All fees and slashed YLD are BURNED (deflationay)
 *
 * STAKE BELOW MINIMUM:
 *   - Caused by FEE  → PENDING + agent can withdraw remaining stake
 *   - Caused by SLASH → PENDING, no withdrawal (punishment for behavior)
 *
 * SCORE:
 *   - Starts at 300 on approval (fixed)
 *   - Only grows through real performance (SCORER_ROLE updates)
 *   - Never influenced by stake amount
 *
 * SLASHING (behavior punishment only):
 *   WARNING    → 10% stake burned, warningCount++, stays ACTIVE
 *   SUSPENSION → 50% stake burned, → PENDING
 *   BAN        → 100% stake burned, → BANNED permanently
 *
 * ROLES:
 *   DEFAULT_ADMIN_ROLE → owner (multisig in production)
 *   SLASHER_ROLE       → Chainlink DON or DAO
 *   SCORER_ROLE        → Chainlink DON (approves + updates scores)
 */
contract AIAgentRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant SCORER_ROLE  = keccak256("SCORER_ROLE");

    // ─── Types ────────────────────────────────────────────────────────────────

    enum AgentStatus { NONE, PENDING, ACTIVE, BANNED }

    enum SlashLevel {
        WARNING,    // 10% — stays ACTIVE
        SUSPENSION, // 50% — → PENDING
        BAN         // 100% — → BANNED permanently
    }

    // Origin of stake reduction — determines if agent can withdraw remainder
    enum StakeReducedBy { FEE, SLASH }

    struct Agent {
        address addr;
        string  name;
        string  agentType;
        uint256 stake;             // current YLD stake
        uint256 score;             // 0–1000, performance only
        AgentStatus status;
        uint256 registeredAt;
        uint256 approvedAt;
        uint256 lastScoreUpdate;
        uint256 lastFeeCollection;  // timestamp of last fee collection
        uint256 warningCount;
        bool    slashPending;       // true if last reduction was by SLASH (no withdrawal)
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SCORE              = 1000;
    uint256 public constant INITIAL_SCORE          = 300;
    uint256 public constant SCORE_THRESHOLD_ACTIVE = 500;
    uint256 public constant WARNING_SLASH_PCT       = 10;
    uint256 public constant SUSPENSION_SLASH_PCT    = 50;
    uint256 public constant FEE_INTERVAL            = 30 days;
    uint256 public constant BURN_ADDRESS_PLACEHOLDER = 0; // see _burn()

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public yld;            // $YLD token
    address public vault;          // YeldenVault — receives USDC slash (future)
    address public burnAddress;    // 0x000...dead for YLD burns

    uint256 public minStake;       // 50e18 YLD
    uint256 public monthlyFee;     // 1e18 YLD max fee (score 0 pays full)

    mapping(address => Agent) private _agents;
    address[] private _agentList;

    uint256 public totalRegistered;
    uint256 public totalActive;
    uint256 public totalSlashed;
    uint256 public totalBurned;     // total YLD burned (slash + fees)

    // ─── Events ───────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string name, string agentType, uint256 stake, uint256 timestamp);
    event AgentApproved(address indexed agent, address indexed approvedBy, uint256 timestamp);
    event AgentSlashed(address indexed agent, SlashLevel level, uint256 burned, uint256 remainingStake, string reason, uint256 timestamp);
    event AgentBanned(address indexed agent, address indexed bannedBy, string reason, uint256 timestamp);
    event AgentSuspended(address indexed agent, uint256 timestamp);
    event AgentExited(address indexed agent, uint256 stakeReturned, uint256 timestamp);
    event FeeCollected(address indexed agent, uint256 feeBurned, uint256 remainingStake, uint256 timestamp);
    event AgentDroppedToPending(address indexed agent, StakeReducedBy reason, uint256 timestamp);
    event ScoreUpdated(address indexed agent, uint256 oldScore, uint256 newScore, uint256 timestamp);
    event MonthlyFeeUpdated(uint256 oldFee, uint256 newFee);
    event MinStakeUpdated(uint256 oldMinStake, uint256 newMinStake);
    event YLDBurned(uint256 amount, string reason);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _yld         $YLD token address
     * @param _minStake    50e18 (50 YLD)
     * @param _monthlyFee  1e18 (1 YLD max monthly fee)
     * @param _vault       YeldenVault address
     * @param _burnAddress 0x000...dead
     * @param _admin       admin (multisig in production)
     */
    constructor(
        address _yld,
        uint256 _minStake,
        uint256 _monthlyFee,
        address _vault,
        address _burnAddress,
        address _admin
    ) {
        require(_yld         != address(0), "Registry: invalid YLD");
        require(_vault       != address(0), "Registry: invalid vault");
        require(_burnAddress != address(0), "Registry: invalid burn address");
        require(_admin       != address(0), "Registry: invalid admin");
        require(_minStake    > 0,           "Registry: invalid min stake");
        require(_monthlyFee  > 0,           "Registry: invalid monthly fee");

        yld         = IERC20(_yld);
        minStake    = _minStake;
        monthlyFee  = _monthlyFee;
        vault       = _vault;
        burnAddress = _burnAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SLASHER_ROLE,       _admin);
        _grantRole(SCORER_ROLE,        _admin);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /**
     * @notice Register as an AI agent. Permissionless.
     * Stake must be >= minStake in YLD.
     * Status: NONE → PENDING
     */
    function registerAgent(
        string calldata name,
        string calldata agentType,
        uint256 stakeAmount
    ) external nonReentrant {
        require(_agents[msg.sender].status == AgentStatus.NONE, "Registry: already registered");
        require(bytes(name).length > 0,      "Registry: name required");
        require(bytes(name).length <= 64,    "Registry: name too long");
        require(bytes(agentType).length > 0, "Registry: agentType required");
        require(stakeAmount >= minStake,      "Registry: stake below minimum");

        yld.safeTransferFrom(msg.sender, address(this), stakeAmount);

        _agents[msg.sender] = Agent({
            addr:               msg.sender,
            name:               name,
            agentType:          agentType,
            stake:              stakeAmount,
            score:              0,
            status:             AgentStatus.PENDING,
            registeredAt:       block.timestamp,
            approvedAt:         0,
            lastScoreUpdate:    0,
            lastFeeCollection:  block.timestamp,
            warningCount:       0,
            slashPending:       false
        });

        _agentList.push(msg.sender);
        totalRegistered++;

        emit AgentRegistered(msg.sender, name, agentType, stakeAmount, block.timestamp);
    }

    // ─── Approval ─────────────────────────────────────────────────────────────

    /**
     * @notice Approve a pending agent. Sets initial score to INITIAL_SCORE (300).
     * Only SCORER_ROLE.
     */
    function approveAgent(address agent) external onlyRole(SCORER_ROLE) {
        Agent storage a = _agents[agent];
        require(a.status == AgentStatus.PENDING, "Registry: not pending");
        require(a.stake >= minStake,              "Registry: stake below minimum");

        a.status              = AgentStatus.ACTIVE;
        a.approvedAt          = block.timestamp;
        a.score               = INITIAL_SCORE;
        a.lastFeeCollection   = block.timestamp;
        a.slashPending        = false;

        totalActive++;

        emit AgentApproved(agent, msg.sender, block.timestamp);
    }

    // ─── Fee Collection ───────────────────────────────────────────────────────

    /**
     * @notice Collect monthly fee from an active agent.
     * Permissionless — anyone can call, typically the DON.
     *
     * Fee = monthlyFee * (MAX_SCORE - score) / MAX_SCORE
     *   score 1000 → fee = 0      (perfect agent free)
     *   score 500  → fee = 50%
     *   score 0    → fee = 100%
     *
     * If stake drops below minStake/2 after fee:
     *   → status = PENDING, slashPending = false (fee origin, can withdraw)
     */
    function collectFee(address agent) external nonReentrant {
        Agent storage a = _agents[agent];
        require(a.status == AgentStatus.ACTIVE, "Registry: agent not active");
        require(
            block.timestamp >= a.lastFeeCollection + FEE_INTERVAL,
            "Registry: fee not due yet"
        );

        uint256 fee = (monthlyFee * (MAX_SCORE - a.score)) / MAX_SCORE;
        a.lastFeeCollection = block.timestamp;

        if (fee == 0) return; // score 1000 — no fee

        // Cap fee to available stake
        if (fee > a.stake) fee = a.stake;

        a.stake -= fee;
        totalBurned += fee;

        // Burn the fee
        _burnYLD(fee, "monthly fee");

        emit FeeCollected(agent, fee, a.stake, block.timestamp);

        // Check if stake dropped below threshold
        if (a.stake < minStake / 2) {
            totalActive--;
            a.status       = AgentStatus.PENDING;
            a.slashPending = false; // fee origin — agent CAN withdraw remainder
            emit AgentDroppedToPending(agent, StakeReducedBy.FEE, block.timestamp);
        }
    }

    /**
     * @notice Batch fee collection — up to 50 agents. Efficient for DON.
     */
    function collectFeeBatch(address[] calldata agents) external nonReentrant {
        require(agents.length <= 50, "Registry: batch too large");

        for (uint256 i = 0; i < agents.length; i++) {
            Agent storage a = _agents[agents[i]];
            if (a.status != AgentStatus.ACTIVE) continue;
            if (block.timestamp < a.lastFeeCollection + FEE_INTERVAL) continue;

            uint256 fee = (monthlyFee * (MAX_SCORE - a.score)) / MAX_SCORE;
            if (fee == 0) {
                a.lastFeeCollection = block.timestamp;
                continue;
            }

            if (fee > a.stake) fee = a.stake;
            a.stake -= fee;
            a.lastFeeCollection = block.timestamp;
            totalBurned += fee;

            _burnYLD(fee, "monthly fee batch");
            emit FeeCollected(agents[i], fee, a.stake, block.timestamp);

            if (a.stake < minStake / 2) {
                totalActive--;
                a.status       = AgentStatus.PENDING;
                a.slashPending = false;
                emit AgentDroppedToPending(agents[i], StakeReducedBy.FEE, block.timestamp);
            }
        }
    }

    // ─── Slashing ─────────────────────────────────────────────────────────────

    /**
     * @notice Slash an agent for bad behavior. Only SLASHER_ROLE.
     *
     * WARNING    → 10% burned, warningCount++, stays ACTIVE
     * SUSPENSION → 50% burned, → PENDING (slashPending=true, no withdrawal)
     * BAN        → 100% burned, → BANNED permanently
     *
     * If stake drops below minStake/2 after WARNING:
     *   → PENDING, slashPending=true (no withdrawal — punishment)
     */
    function slashAgent(
        address agent,
        SlashLevel level,
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        Agent storage a = _agents[agent];
        require(
            a.status == AgentStatus.ACTIVE || a.status == AgentStatus.PENDING,
            "Registry: agent not slashable"
        );

        uint256 burnAmount;

        if (level == SlashLevel.WARNING) {
            require(a.status == AgentStatus.ACTIVE, "Registry: WARNING only for ACTIVE");
            burnAmount = (a.stake * WARNING_SLASH_PCT) / 100;
            a.warningCount++;

        } else if (level == SlashLevel.SUSPENSION) {
            burnAmount = (a.stake * SUSPENSION_SLASH_PCT) / 100;
            if (a.status == AgentStatus.ACTIVE) totalActive--;
            a.status       = AgentStatus.PENDING;
            a.slashPending = true; // no withdrawal allowed
            emit AgentSuspended(agent, block.timestamp);

        } else if (level == SlashLevel.BAN) {
            burnAmount = a.stake;
            if (a.status == AgentStatus.ACTIVE) totalActive--;
            a.status       = AgentStatus.BANNED;
            a.slashPending = true;
            emit AgentBanned(agent, msg.sender, reason, block.timestamp);
        }

        a.stake -= burnAmount;
        totalSlashed++;
        totalBurned += burnAmount;

        if (burnAmount > 0) {
            _burnYLD(burnAmount, "slash");
        }

        emit AgentSlashed(agent, level, burnAmount, a.stake, reason, block.timestamp);

        // WARNING may also drop below threshold
        if (level == SlashLevel.WARNING && a.stake < minStake / 2) {
            totalActive--;
            a.status       = AgentStatus.PENDING;
            a.slashPending = true;
            emit AgentDroppedToPending(agent, StakeReducedBy.SLASH, block.timestamp);
        }
    }

    // ─── Voluntary Exit ───────────────────────────────────────────────────────

    /**
     * @notice Exit voluntarily. Only PENDING agents.
     *
     * If slashPending = false (dropped by fee): full remaining stake returned.
     * If slashPending = true (dropped by slash): stake is burned, no return.
     */
    function voluntaryExit() external nonReentrant {
        Agent storage a = _agents[msg.sender];
        require(a.status == AgentStatus.PENDING, "Registry: only PENDING agents can exit");

        uint256 stakeToReturn = a.stake;
        bool canWithdraw      = !a.slashPending;

        a.stake        = 0;
        a.status       = AgentStatus.NONE;
        a.slashPending = false;

        if (canWithdraw && stakeToReturn > 0) {
            yld.safeTransfer(msg.sender, stakeToReturn);
            emit AgentExited(msg.sender, stakeToReturn, block.timestamp);
        } else if (!canWithdraw && stakeToReturn > 0) {
            // Slash origin — burn the remainder too
            totalBurned += stakeToReturn;
            _burnYLD(stakeToReturn, "exit after slash");
            emit AgentExited(msg.sender, 0, block.timestamp);
        }
    }

    // ─── Score ────────────────────────────────────────────────────────────────

    /**
     * @notice Update agent score. Only SCORER_ROLE.
     * Score reflects real performance — never influenced by stake.
     */
    function updateScore(address agent, uint256 newScore) external onlyRole(SCORER_ROLE) {
        require(_agents[agent].status == AgentStatus.ACTIVE, "Registry: not active");
        require(newScore <= MAX_SCORE, "Registry: score exceeds max");

        uint256 old = _agents[agent].score;
        _agents[agent].score           = newScore;
        _agents[agent].lastScoreUpdate = block.timestamp;

        emit ScoreUpdated(agent, old, newScore, block.timestamp);
    }

    /**
     * @notice Batch score update — up to 50 agents.
     */
    function updateScoreBatch(
        address[] calldata agents,
        uint256[] calldata scores
    ) external onlyRole(SCORER_ROLE) {
        require(agents.length == scores.length, "Registry: length mismatch");
        require(agents.length <= 50,            "Registry: batch too large");

        for (uint256 i = 0; i < agents.length; i++) {
            if (_agents[agents[i]].status != AgentStatus.ACTIVE) continue;
            if (scores[i] > MAX_SCORE) continue;

            uint256 old = _agents[agents[i]].score;
            _agents[agents[i]].score           = scores[i];
            _agents[agents[i]].lastScoreUpdate = block.timestamp;

            emit ScoreUpdated(agents[i], old, scores[i], block.timestamp);
        }
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /// @notice True if agent is ACTIVE and score >= SCORE_THRESHOLD_ACTIVE (500)
    function isEligible(address agent) external view returns (bool) {
        Agent storage a = _agents[agent];
        return a.status == AgentStatus.ACTIVE && a.score >= SCORE_THRESHOLD_ACTIVE;
    }

    function isActive(address agent) external view returns (bool) {
        return _agents[agent].status == AgentStatus.ACTIVE;
    }

    function score(address agent) external view returns (uint256) {
        return _agents[agent].score;
    }

    function stakeOf(address agent) external view returns (uint256) {
        return _agents[agent].stake;
    }

    function statusOf(address agent) external view returns (AgentStatus) {
        return _agents[agent].status;
    }

    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    /// @notice Calculate current fee due for an agent (0 if not due yet)
    function feeDue(address agent) external view returns (uint256) {
        Agent storage a = _agents[agent];
        if (a.status != AgentStatus.ACTIVE) return 0;
        if (block.timestamp < a.lastFeeCollection + FEE_INTERVAL) return 0;
        return (monthlyFee * (MAX_SCORE - a.score)) / MAX_SCORE;
    }

    function getAgentList(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = _agentList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = _agentList[i];
        }
        return result;
    }

    function totalAgents() external view returns (uint256) {
        return _agentList.length;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMonthlyFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFee > 0, "Registry: invalid fee");
        emit MonthlyFeeUpdated(monthlyFee, newFee);
        monthlyFee = newFee;
    }

    function setMinStake(uint256 newMinStake) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMinStake > 0, "Registry: invalid min stake");
        emit MinStakeUpdated(minStake, newMinStake);
        minStake = newMinStake;
    }

    function setVault(address newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVault != address(0), "Registry: invalid vault");
        vault = newVault;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _burnYLD(uint256 amount, string memory reason) internal {
        yld.safeTransfer(burnAddress, amount);
        emit YLDBurned(amount, reason);
    }
}

// ─── Interface ────────────────────────────────────────────────────────────────

interface IYeldenVault {
    function receiveSlash(uint256 amount) external;
}
