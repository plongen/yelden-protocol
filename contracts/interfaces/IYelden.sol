// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IYeldenVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function totalAssets() external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

interface IYeldenDistributor {
    function distribute(uint256 surplus) external;
    function claimZKBonus(uint256 amount, uint256 category) external;
}