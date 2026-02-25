// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ZKVerifier {
    // Placeholder para o contrato de verificação ZK
    // Em produção, usaremos Groth16 verifier

    mapping(bytes32 => bool) public usedNullifiers;

    event BonusClaimed(bytes32 indexed nullifier, uint256 category, uint256 score, uint256 bonus);

    // ✅ CORREÇÃO: O array publicInputs agora tem tamanho 3 para acomodar os índices 0, 1 e 2
    function claimBonus(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[3] memory publicInputs // Mudado de [1] para [3]
    ) external {
        bytes32 nullifier = bytes32(publicInputs[2]); // Agora o índice 2 existe
        require(!usedNullifiers[nullifier], "Already claimed");

        uint256 category = publicInputs[0];
        uint256 score = publicInputs[1];
        uint256 bonus = score * 1e18; // Placeholder

        usedNullifiers[nullifier] = true;
        emit BonusClaimed(nullifier, category, score, bonus);
    }
}