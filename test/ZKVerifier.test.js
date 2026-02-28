// test/ZKVerifier.test.js
// Testes do ZKVerifier integrado ao Groth16Verifier real
//
// Fixtures geradas pelo circuito contribution.circom:
//   score=750, salt=123456789, threshold=500
//   commitmentHash = Poseidon(750, 123456789)
//   nullifierHash  = Poseidon(750, 123456789, 1)
//
// Para rodar: npx hardhat test test/ZKVerifier.test.js

const { expect }       = require("chai");
const { ethers }       = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const snarkjs          = require("snarkjs");
const path             = require("path");
const fs               = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Gera prova Groth16 real usando o zkey e wasm compilados
async function generateProof(score, salt, threshold) {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const scoreBig  = BigInt(score);
  const saltBig   = BigInt(salt);
  const domain    = BigInt(1);

  const commitment = poseidon([scoreBig, saltBig]);
  const nullifier  = poseidon([scoreBig, saltBig, domain]);

  const commitmentHash = F.toString(commitment);
  const nullifierHash  = F.toString(nullifier);

  const input = {
    score:          score.toString(),
    salt:           salt.toString(),
    threshold:      threshold.toString(),
    nullifierHash,
    commitmentHash,
  };

  const wasmPath = path.join(__dirname, "../circuits/build/contribution_js/contribution.wasm");
  const zkeyPath = path.join(__dirname, "../circuits/build/contribution_0001.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

  return { proof, publicSignals, nullifierHash, commitmentHash };
}

// Converte proof do formato snarkjs para o formato Solidity
function proofToSolidity(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────
describe("ZKVerifier — Groth16 integrado", function () {
  // Timeout maior para geração de prova ZK
  this.timeout(120_000);

  let zkVerifier;
  let groth16Verifier;
  let owner, distributor, user, attacker;

  // Prova válida gerada uma vez e reutilizada nos testes
  let validProof;
  let validPublicSignals;
  let validNullifierHash;
  let validCommitmentHash;

  before(async function () {
    [owner, distributor, user, attacker] = await ethers.getSigners();

    // Deploy Groth16Verifier (gerado pelo snarkjs)
    const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
    groth16Verifier = await Groth16Verifier.deploy();
    await groth16Verifier.waitForDeployment();

    // Deploy ZKVerifier apontando para o Groth16Verifier
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy(
      await groth16Verifier.getAddress(),
      distributor.address
    );
    await zkVerifier.waitForDeployment();

    // Gera prova válida uma vez para todos os testes
    const result = await generateProof(750, 123456789, 500);
    validProof          = result.proof;
    validPublicSignals  = result.publicSignals;
    validNullifierHash  = result.nullifierHash;
    validCommitmentHash = result.commitmentHash;
  });

  // ── Deployment ─────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("Deve apontar para o Groth16Verifier correto", async function () {
      expect(await zkVerifier.verifier()).to.equal(
        await groth16Verifier.getAddress()
      );
    });

    it("Deve apontar para o distributor correto", async function () {
      expect(await zkVerifier.distributor()).to.equal(distributor.address);
    });

    it("Nenhum nullifier deve estar usado no deploy", async function () {
      expect(await zkVerifier.isNullifierUsed(validNullifierHash)).to.be.false;
    });
  });

  // ── Prova válida ───────────────────────────────────────────────────────────
  describe("claimBonus — prova válida", function () {
    it("Deve aceitar prova válida (score 750 >= threshold 500)", async function () {
      const { a, b, c } = proofToSolidity(validProof);
      const input = validPublicSignals;

      await expect(
        zkVerifier.connect(user).claimBonus(a, b, c, input)
      ).to.emit(zkVerifier, "BonusClaimed")
       .withArgs(
         validNullifierHash,
         validCommitmentHash,
         500,
         user.address
       );
    });

    it("Deve marcar nullifier como usado após claim", async function () {
      expect(await zkVerifier.isNullifierUsed(validNullifierHash)).to.be.true;
    });

    it("verifyOnly deve retornar false após nullifier usado", async function () {
      const { a, b, c } = proofToSolidity(validProof);
      const input = validPublicSignals;

      expect(
        await zkVerifier.verifyOnly(a, b, c, input)
      ).to.be.false;
    });
  });

  // ── Double claim ───────────────────────────────────────────────────────────
  describe("claimBonus — nullifier duplo", function () {
    it("Deve rejeitar segundo claim com mesmo nullifier", async function () {
      const { a, b, c } = proofToSolidity(validProof);
      const input = validPublicSignals;

      // Primeira tentativa já foi feita no teste anterior
      // Segunda deve falhar
      await expect(
        zkVerifier.connect(user).claimBonus(a, b, c, input)
      ).to.be.revertedWithCustomError(zkVerifier, "NullifierUsed");
    });

    it("Mesmo attacker não pode double-claim", async function () {
      const { a, b, c } = proofToSolidity(validProof);
      const input = validPublicSignals;

      await expect(
        zkVerifier.connect(attacker).claimBonus(a, b, c, input)
      ).to.be.revertedWithCustomError(zkVerifier, "NullifierUsed");
    });
  });

  // ── Score abaixo do threshold ──────────────────────────────────────────────
  describe("claimBonus — score abaixo do threshold", function () {
    it("Deve rejeitar prova com score 300 < threshold 500", async function () {
      // Gera prova com score abaixo do threshold
      // O circuito retorna valid=0 neste caso
      const result = await generateProof(300, 987654321, 500);
      const { a, b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      // input[0] = valid = 0 → ScoreBelowThreshold
      await expect(
        zkVerifier.connect(user).claimBonus(a, b, c, input)
      ).to.be.revertedWithCustomError(zkVerifier, "ScoreBelowThreshold");
    });

    it("verifyOnly deve retornar false para score abaixo do threshold", async function () {
      const result = await generateProof(300, 987654321, 500);
      const { a, b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      expect(
        await zkVerifier.verifyOnly(a, b, c, input)
      ).to.be.false;
    });
  });

  // ── Score exatamente no threshold ─────────────────────────────────────────
  describe("claimBonus — score exatamente no threshold", function () {
    it("Deve aceitar score == threshold (500 >= 500)", async function () {
      const result = await generateProof(500, 111222333, 500);
      const { a, b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      await expect(
        zkVerifier.connect(user).claimBonus(a, b, c, input)
      ).to.emit(zkVerifier, "BonusClaimed");
    });
  });

  // ── Prova inválida (manipulada) ────────────────────────────────────────────
  describe("claimBonus — prova inválida", function () {
    it("Deve rejeitar prova com public inputs manipulados", async function () {
      const result = await generateProof(750, 444555666, 500);
      const { a, b, c } = proofToSolidity(result.proof);

      // Manipula input[0] para fingir valid=1 com prova de score baixo
      const fakeInput = [...result.publicSignals];
      fakeInput[0] = "1"; // tenta forjar valid=1
      fakeInput[1] = "999"; // tenta forjar threshold alto

      // O Groth16Verifier vai rejeitar porque os inputs não batem com a prova
      await expect(
        zkVerifier.connect(attacker).claimBonus(a, b, c, fakeInput)
      ).to.be.revertedWithCustomError(zkVerifier, "InvalidProof");
    });

    it("Deve rejeitar prova com pi_a zerado (prova falsa)", async function () {
      const result = await generateProof(750, 777888999, 500);
      const { b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      const fakeA = ["0", "0"];

      await expect(
        zkVerifier.connect(attacker).claimBonus(fakeA, b, c, input)
      ).to.be.reverted;
    });
  });

  // ── verifyOnly — view function ─────────────────────────────────────────────
  describe("verifyOnly", function () {
    it("Deve retornar true para prova válida não usada", async function () {
      const result = await generateProof(800, 202020202, 500);
      const { a, b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      expect(
        await zkVerifier.verifyOnly(a, b, c, input)
      ).to.be.true;
    });

    it("Deve retornar false após nullifier usado", async function () {
      const result = await generateProof(800, 202020202, 500);
      const { a, b, c } = proofToSolidity(result.proof);
      const input = result.publicSignals;

      // Usa o nullifier
      await zkVerifier.connect(user).claimBonus(a, b, c, input);

      // verifyOnly agora retorna false
      expect(
        await zkVerifier.verifyOnly(a, b, c, input)
      ).to.be.false;
    });
  });

  // ── Diferentes scores e salts ──────────────────────────────────────────────
  describe("Múltiplos claims com diferentes (score, salt)", function () {
    it("Score 999 com salt diferente gera nullifier diferente — ambos aceitos", async function () {
      const result1 = await generateProof(999, 111111111, 500);
      const result2 = await generateProof(999, 222222222, 500);

      const { a: a1, b: b1, c: c1 } = proofToSolidity(result1.proof);
      const { a: a2, b: b2, c: c2 } = proofToSolidity(result2.proof);

      // Dois nullifiers diferentes — ambos devem ser aceitos
      await expect(
        zkVerifier.connect(user).claimBonus(a1, b1, c1, result1.publicSignals)
      ).to.emit(zkVerifier, "BonusClaimed");

      await expect(
        zkVerifier.connect(user).claimBonus(a2, b2, c2, result2.publicSignals)
      ).to.emit(zkVerifier, "BonusClaimed");
    });
  });
});
