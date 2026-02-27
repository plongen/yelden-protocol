// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AIAgentRegistry
 * @notice On-chain reputation registry for autonomous AI agents — with economic slashing.
 *
 * STAKE TOKEN:
 *   Starts as USDC. Migrates to $YLD when token exists via setStakeToken().
 *   Existing agents have STAKE_MIGRATION_WINDOW (30 days) to re-stake in new token.
 *
 * AGENT LIFECYCLE:
 *   NONE → registerAgent() + stake(>=minStake) → PENDING
 *   PENDING → approveAgent() [SCORER_ROLE] → ACTIVE (score = 500)
 *   ACTIVE → slashAgent(WARNING)    → ACTIVE    (10% stake cut, warningCount++)
 *   ACTIVE → slashAgent(SUSPENSION) → PENDING   (50% stake cut)
 *   ACTIVE → slashAgent(BAN)        → BANNED    (100% stake cut)
 *   PENDING → voluntaryExit()       → NONE      (full stake returned)
 *
 * SLASHING DESTINATION:
 *   Slashed stake → vault.receiveSlash() → added to yieldReserve
 *   Protects all depositors of the protocol.
 *
 * YLD MIGRATION:
 *   admin calls setStakeToken(yldAddress) → opens 30-day window
 *   agents call migrateStake(newAmount)   → return USDC, deposit YLD
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
        WARNING,    // 10% — agent stays ACTIVE, warningCount++
        SUSPENSION, // 50% — agent returns to PENDING
        BAN         // 100% — agent BANNED permanently
    }

    struct Agent {
        address addr;
        string  name;
        string  agentType;
        uint256 stake;
        uint256 score;
        AgentStatus status;
        uint256 registeredAt;
        uint256 approvedAt;
        uint256 lastScoreUpdate;
        uint256 warningCount;
        bool    stakeMigrated;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SCORE                  = 1000;
    uint256 public constant SCORE_THRESHOLD_ACTIVE     = 500;
    uint256 public constant SCORE_THRESHOLD_WARNING    = 400;
    uint256 public constant SCORE_THRESHOLD_SUSPENSION = 300;
    uint256 public constant WARNING_SLASH_PCT          = 10;
    uint256 public constant SUSPENSION_SLASH_PCT       = 50;
    uint256 public constant STAKE_MIGRATION_WINDOW     = 30 days;
    uint256 public constant SCORE_UPDATE_INTERVAL      = 7 days;

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public stakeToken;          // USDC now, $YLD after migration
    IERC20  public previousStakeToken;  // set during migration window
    uint256 public migrationDeadline;   // 0 if no active migration
    uint256 public minStake;            // 100e6 USDC or 100e18 YLD
    address public vault;               // receives slashed stake

    mapping(address => Agent) private _agents;
    address[] private _agentList;

    uint256 public totalRegistered;
    uint256 public totalActive;
    uint256 public totalSlashed;
    uint256 public totalSlashedAmount;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string name, string agentType, uint256 stake, uint256 timestamp);
    event AgentApproved(address indexed agent, address indexed approvedBy, uint256 timestamp);
    event AgentSlashed(address indexed agent, SlashLevel level, uint256 slashAmount, uint256 remainingStake, string reason, uint256 timestamp);
    event AgentBanned(address indexed agent, address indexed bannedBy, string reason, uint256 timestamp);
    event AgentExited(address indexed agent, uint256 stakeReturned, uint256 timestamp);
    event ScoreUpdated(address indexed agent, uint256 oldScore, uint256 newScore, uint256 timestamp);
    event StakeTokenMigrationStarted(address indexed oldToken, address indexed newToken, uint256 deadline);
    event StakeMigrated(address indexed agent, uint256 oldAmount, uint256 newAmount, uint256 timestamp);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event MinStakeUpdated(uint256 oldMinStake, uint256 newMinStake);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _stakeToken,
        uint256 _minStake,
        address _vault,
        address _admin
    ) {
        require(_stakeToken != address(0), "Registry: invalid stake token");
        require(_vault      != address(0), "Registry: invalid vault");
        require(_admin      != address(0), "Registry: invalid admin");
        require(_minStake   > 0,           "Registry: invalid min stake");

        stakeToken = IERC20(_stakeToken);
        minStake   = _minStake;
        vault      = _vault;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SLASHER_ROLE,       _admin);
        _grantRole(SCORER_ROLE,        _admin);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

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

        stakeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        _agents[msg.sender] = Agent({
            addr:            msg.sender,
            name:            name,
            agentType:       agentType,
            stake:           stakeAmount,
            score:           0,
            status:          AgentStatus.PENDING,
            registeredAt:    block.timestamp,
            approvedAt:      0,
            lastScoreUpdate: 0,
            warningCount:    0,
            stakeMigrated:   false
        });

        _agentList.push(msg.sender);
        totalRegistered++;

        emit AgentRegistered(msg.sender, name, agentType, stakeAmount, block.timestamp);
    }

    // ─── Approval ─────────────────────────────────────────────────────────────

    function approveAgent(address agent) external onlyRole(SCORER_ROLE) {
        Agent storage a = _agents[agent];
        require(a.status == AgentStatus.PENDING, "Registry: not pending");
        require(a.stake >= minStake,              "Registry: stake below minimum");

        a.status     = AgentStatus.ACTIVE;
        a.approvedAt = block.timestamp;
        a.score      = 500;
        totalActive++;

        emit AgentApproved(agent, msg.sender, block.timestamp);
    }

    // ─── Slashing ─────────────────────────────────────────────────────────────

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

        uint256 slashAmount;

        if (level == SlashLevel.WARNING) {
            require(a.status == AgentStatus.ACTIVE, "Registry: WARNING only for ACTIVE");
            slashAmount = (a.stake * WARNING_SLASH_PCT) / 100;
            a.warningCount++;

        } else if (level == SlashLevel.SUSPENSION) {
            slashAmount = (a.stake * SUSPENSION_SLASH_PCT) / 100;
            if (a.status == AgentStatus.ACTIVE) totalActive--;
            a.status = AgentStatus.PENDING;

        } else if (level == SlashLevel.BAN) {
            slashAmount = a.stake;
            if (a.status == AgentStatus.ACTIVE) totalActive--;
            a.status = AgentStatus.BANNED;
            emit AgentBanned(agent, msg.sender, reason, block.timestamp);
        }

        a.stake -= slashAmount;
        totalSlashed++;
        totalSlashedAmount += slashAmount;

        if (slashAmount > 0) {
            stakeToken.safeTransfer(vault, slashAmount);
            IYeldenVault(vault).receiveSlash(slashAmount);
        }

        emit AgentSlashed(agent, level, slashAmount, a.stake, reason, block.timestamp);
    }

    // ─── Voluntary Exit ───────────────────────────────────────────────────────

    function voluntaryExit() external nonReentrant {
        Agent storage a = _agents[msg.sender];
        require(a.status == AgentStatus.PENDING, "Registry: only PENDING agents can exit");

        uint256 stakeToReturn = a.stake;
        a.stake  = 0;
        a.status = AgentStatus.NONE;

        if (stakeToReturn > 0) {
            stakeToken.safeTransfer(msg.sender, stakeToReturn);
        }

        emit AgentExited(msg.sender, stakeToReturn, block.timestamp);
    }

    // ─── Score ────────────────────────────────────────────────────────────────

    function updateScore(address agent, uint256 newScore) external onlyRole(SCORER_ROLE) {
        require(_agents[agent].status == AgentStatus.ACTIVE, "Registry: not active");
        require(newScore <= MAX_SCORE, "Registry: score exceeds max");

        uint256 old = _agents[agent].score;
        _agents[agent].score           = newScore;
        _agents[agent].lastScoreUpdate = block.timestamp;

        emit ScoreUpdated(agent, old, newScore, block.timestamp);
    }

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

    // ─── YLD Migration ────────────────────────────────────────────────────────

    function setStakeToken(
        address newToken,
        uint256 newMinStake
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newToken    != address(0), "Registry: invalid token");
        require(newMinStake > 0,           "Registry: invalid min stake");
        require(
            migrationDeadline == 0 || block.timestamp > migrationDeadline,
            "Registry: migration in progress"
        );

        previousStakeToken = stakeToken;
        stakeToken         = IERC20(newToken);
        minStake           = newMinStake;
        migrationDeadline  = block.timestamp + STAKE_MIGRATION_WINDOW;

        emit StakeTokenMigrationStarted(address(previousStakeToken), newToken, migrationDeadline);
    }

    function migrateStake(uint256 newStakeAmount) external nonReentrant {
        require(
            migrationDeadline > 0 && block.timestamp <= migrationDeadline,
            "Registry: no active migration"
        );
        Agent storage a = _agents[msg.sender];
        require(
            a.status == AgentStatus.ACTIVE || a.status == AgentStatus.PENDING,
            "Registry: not registered"
        );
        require(!a.stakeMigrated,          "Registry: already migrated");
        require(newStakeAmount >= minStake, "Registry: stake below minimum");

        uint256 oldStake = a.stake;

        stakeToken.safeTransferFrom(msg.sender, address(this), newStakeAmount);

        if (oldStake > 0) {
            previousStakeToken.safeTransfer(msg.sender, oldStake);
        }

        a.stake         = newStakeAmount;
        a.stakeMigrated = true;

        emit StakeMigrated(msg.sender, oldStake, newStakeAmount, block.timestamp);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

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

    function isMigrationActive() external view returns (bool) {
        return migrationDeadline > 0 && block.timestamp <= migrationDeadline;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setVault(address newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVault != address(0), "Registry: invalid vault");
        emit VaultUpdated(vault, newVault);
        vault = newVault;
    }

    function setMinStake(uint256 newMinStake) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMinStake > 0, "Registry: invalid min stake");
        emit MinStakeUpdated(minStake, newMinStake);
        minStake = newMinStake;
    }
}

// ─── Interface ────────────────────────────────────────────────────────────────

interface IYeldenVault {
    function receiveSlash(uint256 amount) external;
}
