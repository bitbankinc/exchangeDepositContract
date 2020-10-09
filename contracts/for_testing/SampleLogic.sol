// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.11;
import '../ExchangeDeposit.sol';

/**
 * @dev This is a sample to show how adding new logic would work
 */
contract SampleLogic {
    // The logic contracts need the same storage structure
    address payable public coldAddress;
    uint256 public minimumInput;
    address payable public implementation;

    /**
     * @dev gather only half of ERC20.
     * We know the test will only call from proxy, so exchangeDepositorAddress is not 0x0.
     */
    function gatherHalfErc20(ERC20Interface instance) public {
        uint256 forwarderBalance = instance.balanceOf(address(this));
        if (forwarderBalance == 0) {
            return;
        }
        if (
            !instance.transfer(
                ExchangeDeposit(exchangeDepositorAddress()).coldAddress(),
                forwarderBalance / 2
            )
        ) {
            revert('Could not gather half of ERC20');
        }
    }

    /**
     * @notice exchangeDepositorAddress is the address to which the proxy will forward.
     * @dev Any address that is not a proxy will return 0x0 address.
     * @return returnAddr The address the proxy forwards to.
     */
    function exchangeDepositorAddress()
        public
        view
        returns (address payable returnAddr)
    {
        assembly {
            let me := address()
            let mysize := extcodesize(me)
            // The deployed code is 65 bytes, this check is quick.
            if eq(mysize, 64) {
                let ptr := mload(0x40)
                // We want to be secure, so check if the code 100% matches our code.
                extcodecopy(me, ptr, 0, mysize)
                // bytes [1:21) are a dynamic address, so mask it away.
                // bytes [65:96) are irrelevant, so mask them away just in case.
                // Check if the contract matches what we deployed exactly.
                if and(
                    eq(
                        and(
                            // first 32 bytes bitwise AND with deployed contract address gone
                            mload(ptr),
                            // 00 in the mask is where the dynamic address is.
                            0xff0000000000000000000000000000000000000000ffffffffffffffffffffff
                        ),
                        // our contract minus address
                        0x7300000000000000000000000000000000000000003d366025573d3d3d3d3486
                    ),
                    eq(
                        mload(add(ptr, 0x20)), // second piece of the contract
                        0x5af16031565b363d3d373d3d363d855af45b3d82803e603c573d81fd5b3d81f3
                    )
                ) {
                    // code before address is 1 byte, need 12 bytes (+20 == 32)
                    // bitwise AND with 20 byte mask
                    returnAddr := and(
                        mload(sub(ptr, 11)),
                        0xffffffffffffffffffffffffffffffffffffffff
                    )
                }
            }
        }
    }
}
