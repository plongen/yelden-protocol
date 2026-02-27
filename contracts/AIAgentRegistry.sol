// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AIAgentRegistry
 * @notice Registro on-chain de agentes AI do protocolo Yelden.
 *
 * FLUXO:
 *   1. Qualquer endereço chama registerAgent() pagando REGISTRATION_FEE em USDC
 *   2. Status inicial: PENDING
 *   3. DON (ou owner em fase inicial) chama approveAgent() → status: ACTIVE
 *   4. DON atualiza score periodicamente via updateScore()
 *   5. YeldenDistributor consulta isActive() e score() antes de pagar bônus
 *   6. Owner pode banir agentes via banAgent()
 *
 * STATUS:
 *   NONE    → endereço nunca registrou
 *   PENDING → registrou, aguarda validação
 *   ACTIVE  → aprovado, pode receber bônus
 *   BANNED  → banido, não pode receber bônus
 *
 * TODO: migrar REGISTRATION_FEE de USDC para $YLD quando token existir
 */
contract AIAgentRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Tipos ────────────────────────────────────────────────────────────────

    enum AgentStatus { NONE, PENDING, ACTIVE, BANNED }

    struct Agent {
        address addr;           // endereço do agente
        string  name;           // nome público (ex: "Yelden Monitor v1")
        string  agentType;      // tipo: "monitor" | "optimizer" | "governance"
        uint256 score;          // 0–1000, atualizado pelo DON
        uint256 registeredAt;   // timestamp do registro
        uint256 approvedAt;     // timestamp da aprovação (0 se pending)
        uint256 lastScoreUpdate;// timestamp da última atualização de score
        AgentStatus status;
    }

    // ─── Constantes ───────────────────────────────────────────────────────────

    uint256 public constant MAX_SCORE         = 1000;
    uint256 public constant MIN_ACTIVE_SCORE  = 500;   // score mínimo para receber bônus
    uint256 public constant SCORE_UPDATE_INTERVAL = 7 days; // DON atualiza a cada 7 dias

    // TODO: migrar para $YLD
    uint256 public constant REGISTRATION_FEE  = 10e6;  // 10 USDC (6 decimais)

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable feeToken;   // USDC (ou $YLD no futuro)
    address public           don;        // endereço do Chainlink DON operator
    address public           feeRecipient; // onde as taxas de registro vão

    mapping(address => Agent)   private _agents;
    address[]                   private _agentList;

    uint256 public totalRegistered;
    uint256 public totalActive;
    uint256 public totalBanned;

    // ─── Eventos ──────────────────────────────────────────────────────────────

    event AgentRegistered(
        address indexed agent,
        string  name,
        string  agentType,
        uint256 timestamp
    );

    event AgentApproved(
        address indexed agent,
        address indexed approvedBy,
        uint256 timestamp
    );

    event AgentBanned(
        address indexed agent,
        address indexed bannedBy,
        string  reason,
        uint256 timestamp
    );

    event ScoreUpdated(
        address indexed agent,
        uint256 oldScore,
        uint256 newScore,
        uint256 timestamp
    );

    event DonUpdated(address indexed oldDon, address indexed newDon);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event FeeWithdrawn(address indexed recipient, uint256 amount);

    // ─── Modificadores ────────────────────────────────────────────────────────

    modifier onlyDonOrOwner() {
        require(
            msg.sender == don || msg.sender == owner(),
            "Registry: caller is not DON or owner"
        );
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _feeToken    endereço do USDC (ou token de taxa)
     * @param _don         endereço do operador Chainlink DON
     * @param _feeRecipient onde as taxas de registro são enviadas
     */
    constructor(
        address _feeToken,
        address _don,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_feeToken    != address(0), "Registry: invalid fee token");
        require(_don         != address(0), "Registry: invalid DON address");
        require(_feeRecipient != address(0), "Registry: invalid fee recipient");

        feeToken     = IERC20(_feeToken);
        don          = _don;
        feeRecipient = _feeRecipient;
    }

    // ─── Registro ─────────────────────────────────────────────────────────────

    /**
     * @notice Registra um novo agente AI. Qualquer endereço pode chamar.
     * @param name      nome público do agente
     * @param agentType tipo do agente: "monitor" | "optimizer" | "governance"
     *
     * Requer aprovação prévia de REGISTRATION_FEE em feeToken.
     * Status inicial: PENDING.
     */
    function registerAgent(
        string calldata name,
        string calldata agentType
    ) external nonReentrant {
        require(_agents[msg.sender].status == AgentStatus.NONE, "Registry: already registered");
        require(bytes(name).length > 0,      "Registry: name required");
        require(bytes(name).length <= 64,    "Registry: name too long");
        require(bytes(agentType).length > 0, "Registry: agentType required");

        // Cobrar taxa anti-spam
        feeToken.safeTransferFrom(msg.sender, feeRecipient, REGISTRATION_FEE);

        _agents[msg.sender] = Agent({
            addr:            msg.sender,
            name:            name,
            agentType:       agentType,
            score:           0,
            registeredAt:    block.timestamp,
            approvedAt:      0,
            lastScoreUpdate: 0,
            status:          AgentStatus.PENDING
        });

        _agentList.push(msg.sender);
        totalRegistered++;

        emit AgentRegistered(msg.sender, name, agentType, block.timestamp);
    }

    // ─── Aprovação / Banimento ────────────────────────────────────────────────

    /**
     * @notice Aprova um agente pendente. Só DON ou owner.
     * @param agent endereço do agente a aprovar
     */
    function approveAgent(address agent) external onlyDonOrOwner {
        require(_agents[agent].status == AgentStatus.PENDING, "Registry: not pending");

        _agents[agent].status     = AgentStatus.ACTIVE;
        _agents[agent].approvedAt = block.timestamp;
        _agents[agent].score      = 500; // score inicial padrão ao aprovar

        totalActive++;

        emit AgentApproved(agent, msg.sender, block.timestamp);
    }

    /**
     * @notice Bane um agente. Só owner.
     * @param agent  endereço do agente a banir
     * @param reason motivo do banimento (registrado no evento)
     */
    function banAgent(address agent, string calldata reason) external onlyOwner {
        AgentStatus current = _agents[agent].status;
        require(
            current == AgentStatus.ACTIVE || current == AgentStatus.PENDING,
            "Registry: cannot ban"
        );

        if (current == AgentStatus.ACTIVE) {
            totalActive--;
        }

        _agents[agent].status = AgentStatus.BANNED;
        totalBanned++;

        emit AgentBanned(agent, msg.sender, reason, block.timestamp);
    }

    // ─── Score ────────────────────────────────────────────────────────────────

    /**
     * @notice Atualiza o score de um agente. Só DON ou owner.
     * @param agent    endereço do agente
     * @param newScore novo score (0–1000)
     */
    function updateScore(address agent, uint256 newScore) external onlyDonOrOwner {
        require(_agents[agent].status == AgentStatus.ACTIVE, "Registry: agent not active");
        require(newScore <= MAX_SCORE, "Registry: score exceeds max");

        uint256 old = _agents[agent].score;
        _agents[agent].score           = newScore;
        _agents[agent].lastScoreUpdate = block.timestamp;

        emit ScoreUpdated(agent, old, newScore, block.timestamp);
    }

    /**
     * @notice Atualiza scores de múltiplos agentes em batch. Economiza gas para o DON.
     */
    function updateScoreBatch(
        address[] calldata agents,
        uint256[] calldata scores
    ) external onlyDonOrOwner {
        require(agents.length == scores.length, "Registry: length mismatch");
        require(agents.length <= 50, "Registry: batch too large");

        for (uint256 i = 0; i < agents.length; i++) {
            if (_agents[agents[i]].status != AgentStatus.ACTIVE) continue;
            if (scores[i] > MAX_SCORE) continue;

            uint256 old = _agents[agents[i]].score;
            _agents[agents[i]].score           = scores[i];
            _agents[agents[i]].lastScoreUpdate = block.timestamp;

            emit ScoreUpdated(agents[i], old, scores[i], block.timestamp);
        }
    }

    // ─── View Functions (para YeldenDistributor) ──────────────────────────────

    /**
     * @notice Retorna true se o agente está ACTIVE e tem score >= MIN_ACTIVE_SCORE.
     * Usado pelo YeldenDistributor antes de pagar bônus.
     */
    function isEligible(address agent) external view returns (bool) {
        Agent storage a = _agents[agent];
        return a.status == AgentStatus.ACTIVE && a.score >= MIN_ACTIVE_SCORE;
    }

    /**
     * @notice Retorna true se o agente está ACTIVE (independente de score).
     */
    function isActive(address agent) external view returns (bool) {
        return _agents[agent].status == AgentStatus.ACTIVE;
    }

    /**
     * @notice Retorna o score atual do agente.
     */
    function score(address agent) external view returns (uint256) {
        return _agents[agent].score;
    }

    /**
     * @notice Retorna o status do agente.
     */
    function statusOf(address agent) external view returns (AgentStatus) {
        return _agents[agent].status;
    }

    /**
     * @notice Retorna o perfil completo do agente.
     */
    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    /**
     * @notice Retorna lista paginada de agentes registrados.
     * @param offset índice inicial
     * @param limit  quantidade máxima a retornar
     */
    function getAgentList(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        uint256 total = _agentList.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = _agentList[i];
        }
        return result;
    }

    /**
     * @notice Total de agentes na lista.
     */
    function totalAgents() external view returns (uint256) {
        return _agentList.length;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Atualiza o endereço do DON. Só owner.
     */
    function setDon(address newDon) external onlyOwner {
        require(newDon != address(0), "Registry: invalid DON");
        emit DonUpdated(don, newDon);
        don = newDon;
    }

    /**
     * @notice Atualiza o destinatário das taxas. Só owner.
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Registry: invalid recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }
}
