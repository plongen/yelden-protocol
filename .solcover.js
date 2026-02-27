/**
 * .solcover.js — solidity-coverage configuration for Yelden Protocol
 *
 * Install: npm install --save-dev solidity-coverage
 * Run:     npx hardhat coverage
 * Output:  coverage/index.html  (HTML report)
 *          coverage/lcov.info   (for CI/codecov)
 */

module.exports = {
  // Skip test files and mocks from coverage
  skipFiles: [
    "mocks/",
    "test/"
  ],

  // Measure branch coverage as well as line/statement/function
  measureBranchCoverage: true,
  measureStatementCoverage: true,
  measureFunctionCoverage: true,

  // Minimum thresholds — CI fails below these
  // Adjust after first run
  istanbulReporter: ["html", "lcov", "text", "json-summary"],

  // Timeout for instrumented tests (longer than normal due to instrumentation)
  mocha: {
    timeout: 300000
  },

  // Print per-file summary to console
  silent: false
};
