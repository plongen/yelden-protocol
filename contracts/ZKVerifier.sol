// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// IGroth16Verifier — interface do contrato gerado pelo snarkjs
// Groth16Verifier.sol em contracts/zk/Groth16Verifier.sol
// ─────────────────────────────────────────────────────────────────────────────
interface IGroth16Verifier {
    function verifyProof(
        uint[2]    memory a,
        uint[2][2] memory b,
        uint[2]    memory c,
        uint[4]    memory input
    ) external view returns (bool);
}

// ─────────────────────────────────────────────────────────────────────────────
// ZKVerifier — integra o Groth16Verifier real ao protocolo Yelden
//
// Public inputs do circuito contribution.circom (ordem do public.json):
//   input[0] = valid          (1 = score >= threshold, 0 = inválido)
//   input[1] = threshold      (mínimo exigido, ex: 500)
//   input[2] = nullifierHash  (Poseidon(score, salt, 1) — evita double-claim)
//   input[3] = commitmentHash (Poseidon(score, salt) — garante consistência)
// ─────────────────────────────────────────────────────────────────────────────
contract ZKVerifier {

    // ── Estado ───────────────────────────────────────────────────────────────
    IGroth16Verifier public immutable verifier;
    address          public immutable distributor;

    mapping(uint256 => bool) public usedNullifiers;

    // ── Eventos ──────────────────────────────────────────────────────────────
    event BonusClaimed(
        uint256 indexed nullifierHash,
        uint256         commitmentHash,
        uint256         threshold,
        address indexed claimer
    );

    // ── Erros ────────────────────────────────────────────────────────────────
    error InvalidProof();
    error NullifierUsed();
    error ScoreBelowThreshold();
    error OnlyDistributor();

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(address _verifier, address _distributor) {
        verifier    = IGroth16Verifier(_verifier);
        distributor = _distributor;
    }

    // ── Modificadores ────────────────────────────────────────────────────────
    modifier onlyDistributor() {
        if (msg.sender != distributor) revert OnlyDistributor();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // claimBonus — ponto de entrada principal
    //
    // Parâmetros:
    //   a, b, c    — prova Groth16 (gerada pelo snarkjs)
    //   input[4]   — public inputs na ordem do circuito:
    //                [0] valid, [1] threshold, [2] nullifierHash, [3] commitmentHash
    //
    // Fluxo:
    //   1. Verifica prova Groth16 on-chain
    //   2. Confirma que valid == 1 (score >= threshold provado)
    //   3. Confirma que nullifier não foi usado
    //   4. Marca nullifier como usado
    //   5. Emite evento — YeldenDistributor escuta e libera bonus
    // ─────────────────────────────────────────────────────────────────────────
    function claimBonus(
        uint[2]    memory a,
        uint[2][2] memory b,
        uint[2]    memory c,
        uint[4]    memory input
    ) external {
        // input[0] = valid — o circuito prova que score >= threshold
        if (input[0] != 1) revert ScoreBelowThreshold();

        uint256 nullifierHash  = input[2];
        uint256 commitmentHash = input[3];
        uint256 threshold      = input[1];

        // Nullifier não pode ter sido usado antes
        if (usedNullifiers[nullifierHash]) revert NullifierUsed();

        // Verifica a prova Groth16 on-chain
        bool valid = verifier.verifyProof(a, b, c, input);
        if (!valid) revert InvalidProof();

        // Marca nullifier como usado — evita double-claim
        usedNullifiers[nullifierHash] = true;

        emit BonusClaimed(nullifierHash, commitmentHash, threshold, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // verifyOnly — view function para validar prova sem state change
    // Útil para simulações off-chain e testes
    // ─────────────────────────────────────────────────────────────────────────
    function verifyOnly(
        uint[2]    memory a,
        uint[2][2] memory b,
        uint[2]    memory c,
        uint[4]    memory input
    ) external view returns (bool) {
        if (input[0] != 1)                   return false;
        if (usedNullifiers[input[2]])         return false;
        return verifier.verifyProof(a, b, c, input);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // isNullifierUsed — consulta se um nullifier já foi utilizado
    // ─────────────────────────────────────────────────────────────────────────
    function isNullifierUsed(uint256 nullifierHash) external view returns (bool) {
        return usedNullifiers[nullifierHash];
    }
}
