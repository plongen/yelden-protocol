/**
 * YeldenVault — Mutation Testing
 *
 * Tool: mutation-testing via manual mutations + Hardhat
 * Each mutation introduces a deliberate bug into the contract.
 * ALL mutations must cause at least one test to FAIL.
 * A mutation that passes all tests = a test coverage gap.
 *
 * Run: node test/mutation/run-mutations.js
 *
 * Results are written to: test/mutation/mutation-report.json
 */

const { execSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const VAULT_SRC  = path.resolve(__dirname, "../../contracts/YeldenVault.sol");
const VAULT_BAK  = path.resolve(__dirname, "../../contracts/YeldenVault.original.sol");
const REPORT     = path.resolve(__dirname, "mutation-report.json");

// ─── MUTATION DEFINITIONS ────────────────────────────────────────────────────
// Each mutation: { id, description, find, replace }
// find/replace are exact strings in YeldenVault.sol

const MUTATIONS = [
  {
    id: "M01",
    description: "Remove zero-deposit check — allows deposit(0) to mint 0 shares",
    find:    `require(assets > 0, "Zero deposit");`,
    replace: `// require(assets > 0, "Zero deposit"); // MUTATED`
  },
  {
    id: "M02",
    description: "Remove zero-shares check — allows deposit to mint 0 shares with small amount",
    find:    `require(shares > 0, "Zero shares");\n\n        asset.safeTransferFrom`,
    replace: `// require(shares > 0, "Zero shares"); // MUTATED\n\n        asset.safeTransferFrom`
  },
  {
    id: "M03",
    description: "Flip BASE_YIELD_BPS to 0 — no base yield allocated, all goes to surplus",
    find:    `uint256 public constant BASE_YIELD_BPS  = 450;`,
    replace: `uint256 public constant BASE_YIELD_BPS  = 0; // MUTATED`
  },
  {
    id: "M04",
    description: "Remove onlyOwner from harvest — anyone can harvest",
    find:    `function harvest(uint256 grossYield) external onlyOwner {`,
    replace: `function harvest(uint256 grossYield) external /* onlyOwner MUTATED */ {`
  },
  {
    id: "M05",
    description: "Subtract instead of add to yieldReserve — reserve drains on harvest",
    find:    `yieldReserve += toReserve;`,
    replace: `yieldReserve -= toReserve; // MUTATED`
  },
  {
    id: "M06",
    description: "Remove reentrancy guard from deposit — enables reentrancy attack",
    find:    `function deposit(uint256 assets, address receiver)\n        external\n        nonReentrant`,
    replace: `function deposit(uint256 assets, address receiver)\n        external\n        /* nonReentrant MUTATED */`
  },
  {
    id: "M07",
    description: "Remove distributor check in harvest — harvest succeeds without distributor",
    find:    `require(address(distributor) != address(0), "Distributor not set");`,
    replace: `// require(address(distributor) != address(0), "Distributor not set"); // MUTATED`
  },
  {
    id: "M08",
    description: "Swap receiver and owner in Withdraw event — incorrect event args",
    find:    `emit Withdraw(msg.sender, receiver, owner, assets, shares);`,
    replace: `emit Withdraw(msg.sender, owner, receiver, assets, shares); // MUTATED`
  },
  {
    id: "M09",
    description: "Remove allowance check in withdraw — delegated withdrawal without approval",
    find:    `if (msg.sender != owner) {\n            _spendAllowance(owner, msg.sender, shares);\n        }\n\n        _burn(owner, shares);\n        asset.safeTransfer(receiver, assets);\n\n        emit Withdraw`,
    replace: `// if (msg.sender != owner) { ... } // MUTATED\n\n        _burn(owner, shares);\n        asset.safeTransfer(receiver, assets);\n\n        emit Withdraw`
  },
  {
    id: "M10",
    description: "Flip surplus calculation — surplus becomes negative-equivalent",
    find:    `uint256 surplus = grossYield - base - regen;`,
    replace: `uint256 surplus = grossYield + base + regen; // MUTATED`
  }
];

// ─── RUNNER ──────────────────────────────────────────────────────────────────

async function runMutations() {
  const original = fs.readFileSync(VAULT_SRC, "utf8");

  // GUARD: detect coverage instrumentation
  if (original.includes("__coverageInit") || original.includes("global.__coverage__")) {
    console.error("❌ Contract is coverage-instrumented. Run: npx hardhat clean && npx hardhat compile");
    process.exit(1);
  }

  // Save backup with a name coverage won't touch
  fs.writeFileSync(VAULT_BAK, original);
  console.log("✅ Backup saved:", VAULT_BAK);

  // Clean stale artifacts before starting
  try { execSync("npx hardhat clean 2>&1", { timeout: 30000, encoding: "utf8" }); } catch(e) {}
  try { execSync("npx hardhat compile --quiet 2>&1", { timeout: 60000, encoding: "utf8" }); } catch(e) {}

  const results = [];
  let killed = 0;
  let survived = 0;

  console.log(`\n🧬 Running ${MUTATIONS.length} mutations...\n`);

  try {
  for (const mutation of MUTATIONS) {
    const mutated = original.replace(mutation.find, mutation.replace);

    if (mutated === original) {
      console.log(`  ⚠️  ${mutation.id} — find string not found in source (check mutation definition)`);
      results.push({ ...mutation, status: "NOT_FOUND", output: "" });
      continue;
    }

    // Write mutated contract
    fs.writeFileSync(VAULT_SRC, mutated);

    let testPassed = false;
    let output = "";

    try {
      output = execSync("npx hardhat compile --quiet && npx hardhat test --bail 2>&1", {
        timeout: 120000,
        encoding: "utf8"
      });
      // If tests pass — mutation SURVIVED (bad — our tests missed it)
      testPassed = true;
    } catch (err) {
      // Tests failed — mutation KILLED (good — our tests caught it)
      output = err.stdout || err.message;
      testPassed = false;
    }

    const status = testPassed ? "SURVIVED" : "KILLED";
    if (testPassed) {
      survived++;
      console.log(`  ❌ ${mutation.id} SURVIVED — ${mutation.description}`);
      console.log(`     ⚠️  GAP: Tests did not catch this mutation\n`);
    } else {
      killed++;
      console.log(`  ✅ ${mutation.id} KILLED — ${mutation.description}`);
    }

    results.push({ ...mutation, status, output: output.slice(0, 500) });

    // Restore original after EACH mutation
    fs.writeFileSync(VAULT_SRC, original);
  }
  } finally {
    // ALWAYS restore — even if script crashes mid-run
    fs.writeFileSync(VAULT_SRC, original);
    if (fs.existsSync(VAULT_BAK)) fs.unlinkSync(VAULT_BAK);
    // Final clean so next hardhat run uses clean artifacts
    try { execSync("npx hardhat clean 2>&1", { timeout: 30000, encoding: "utf8" }); } catch(e) {}
    console.log("✅ Contract restored. Artifacts cleaned.");
  }

  // Write report
  const score = ((killed / MUTATIONS.length) * 100).toFixed(1);
  const report = {
    timestamp: new Date().toISOString(),
    total: MUTATIONS.length,
    killed,
    survived,
    score: `${score}%`,
    mutations: results
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log(`\n${"─".repeat(50)}`);
  console.log(`🧬 Mutation Score: ${score}% (${killed}/${MUTATIONS.length} killed)`);
  if (survived > 0) {
    console.log(`\n⚠️  Survived mutations (coverage gaps):`);
    results.filter(r => r.status === "SURVIVED").forEach(r => {
      console.log(`   • ${r.id}: ${r.description}`);
    });
  } else {
    console.log(`✅ All mutations killed — test suite is robust`);
  }
  console.log(`\nReport: ${REPORT}\n`);
}

runMutations().catch(console.error);
