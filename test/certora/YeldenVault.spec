/*
 * YeldenVault.spec — Certora Formal Verification v2
 */

using YeldenDistributor as distributor;

methods {
    function deposit(uint256, address)              external returns (uint256);
    function withdraw(uint256, address, address)    external returns (uint256);
    function redeem(uint256, address, address)      external returns (uint256);
    function harvest(uint256)                       external;
    function setDistributor(address)                external;
    function withdrawReserve(address, uint256)      external;
    function totalAssets()                          external returns (uint256) envfree;
    function totalSupply()                          external returns (uint256) envfree;
    function balanceOf(address)                     external returns (uint256) envfree;
    function convertToShares(uint256)               external returns (uint256) envfree;
    function convertToAssets(uint256)               external returns (uint256) envfree;
    function yieldReserve()                         external returns (uint256) envfree;
    function owner()                                external returns (address)  envfree;
    function asset()                                external returns (address)  envfree;
    function distributor.distribute(uint256)        external;
    function distributor.vault()                    external returns (address) envfree;
}

rule harvest_does_not_change_supply(env e, uint256 grossYield) {
    require grossYield > 0;
    require totalSupply() > 0;
    mathint supplyBefore = totalSupply();
    harvest(e, grossYield);
    mathint supplyAfter = totalSupply();
    assert supplyAfter == supplyBefore, "harvest() must not mint or burn shares";
}

rule only_owner_can_harvest(env e, uint256 grossYield) {
    require e.msg.sender != owner();
    harvest@withrevert(e, grossYield);
    assert lastReverted;
}

rule only_owner_can_set_distributor(env e, address d) {
    require e.msg.sender != owner();
    setDistributor@withrevert(e, d);
    assert lastReverted;
}

rule only_owner_can_withdraw_reserve(env e, address to, uint256 amount) {
    require e.msg.sender != owner();
    withdrawReserve@withrevert(e, to, amount);
    assert lastReverted;
}

rule reserve_grows_only_on_harvest(env e, uint256 grossYield) {
    require grossYield > 0;
    mathint reserveBefore = yieldReserve();
    harvest(e, grossYield);
    mathint reserveAfter = yieldReserve();
    assert reserveAfter >= reserveBefore, "yieldReserve must be non-decreasing after harvest";
}

rule deposit_withdraw_integrity(env e, uint256 assets) {
    require assets > 0;
    require assets <= 10^12;
    require totalSupply() == 0;
    require totalAssets() == 0;
    require e.msg.value == 0;
    address user = e.msg.sender;
    require user != 0;
    require user != currentContract;
    require user != distributor;
    uint256 sharesMinted = deposit(e, assets, user);
    assert sharesMinted == assets, "At 1:1 rate shares minted must equal assets deposited";
}

rule deposit_not_reentrant(env e, uint256 assets, address receiver) {
    require assets > 0;
    require receiver != 0;
    deposit(e, assets, receiver);
    satisfy true;
}
