// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IPancakeFactory {
    function INIT_CODE_HASH() external view returns (bytes32);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}