// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev This is so we don't have to import ExchangeDeposit.
// etherscan verification API was including this test source file.
contract ExchangeDepositDummy {
    address payable public coldAddress;
}
