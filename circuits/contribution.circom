pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

template ContributionProof() {
    signal input score;
    signal input salt;
    signal input threshold;
    signal input nullifierHash;
    signal input commitmentHash;
    signal output valid;

    component scoreUpperBound = LessThan(11);
    scoreUpperBound.in[0] <== score;
    scoreUpperBound.in[1] <== 1001;
    scoreUpperBound.out === 1;

    component thresholdBound = LessThan(11);
    thresholdBound.in[0] <== threshold;
    thresholdBound.in[1] <== 1001;
    thresholdBound.out === 1;

    component geq = GreaterEqThan(11);
    geq.in[0] <== score;
    geq.in[1] <== threshold;
    signal scoreValid <== geq.out;

    component commitmentComp = Poseidon(2);
    commitmentComp.inputs[0] <== score;
    commitmentComp.inputs[1] <== salt;
    commitmentHash === commitmentComp.out;

    var NULLIFIER_DOMAIN = 1;

    component nullifierComp = Poseidon(3);
    nullifierComp.inputs[0] <== score;
    nullifierComp.inputs[1] <== salt;
    nullifierComp.inputs[2] <== NULLIFIER_DOMAIN;
    nullifierHash === nullifierComp.out;

    valid <== scoreValid;
}

component main {public [threshold, nullifierHash, commitmentHash]} = ContributionProof();
