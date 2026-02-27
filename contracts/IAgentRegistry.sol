// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentRegistry
 * @notice Interface mínima que o YeldenDistributor usa para validar agentes.
 */
interface IAgentRegistry {
    /// @notice Retorna true se o agente está ACTIVE e score >= MIN_ACTIVE_SCORE
    function isEligible(address agent) external view returns (bool);

    /// @notice Retorna true se o agente está ACTIVE
    function isActive(address agent) external view returns (bool);

    /// @notice Retorna o score atual (0–1000)
    function score(address agent) external view returns (uint256);
}
