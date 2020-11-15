// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;

/**
 * @dev This is a sample to show how adding new logic would work
 */
contract SampleLogic {
    using SafeERC20 for IERC20;
    // The logic contracts need the same storage structure
    address payable public coldAddress;
    uint256 public minimumInput;
    address payable public implementation;

    /**
     * @dev gather only half of ERC20.
     * We know the test will only call from proxy, so exchangeDepositorAddress is not 0x0.
     */
    function gatherHalfErc20(IERC20 instance) public {
        uint256 forwarderBalance = instance.balanceOf(address(this));
        if (forwarderBalance == 0) {
            return;
        }
        instance.safeTransfer(
            ExchangeDepositDummy(exchangeDepositorAddress()).coldAddress(),
            forwarderBalance / 2
        );
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

    /**
     * @dev This function is here to test the case in exchangeDepositorAddress
     * where the code is 64 bytes but NOT equal to our code.
     * The code has been changed by one byte (DUP1 to DUP4, it DUPs the same item)
     * @return returnAddr The new contract address.
     */
    function deploySpecialInstance(bytes32 salt)
        public
        returns (address payable returnAddr)
    {
        assembly {
            let ptr := mload(0x40)
            mstore(
                ptr,
                or(
                    0x604080600a3d393df3fe730000000000000000000000000000000000000000,
                    address()
                )
            )
            mstore(
                add(ptr, 0x20),
                // Changed the last byte from 80 to 83 (same result, DUPing 0x0)
                0x3d366025573d3d3d3d34865af16031565b363d3d373d3d363d855af45b3d8283
            )
            mstore(
                add(ptr, 0x40),
                0x3e603c573d81fd5b3d81f3000000000000000000000000000000000000000000
            )
            returnAddr := create2(0, add(ptr, 0x1), 0x4a, salt)
            if eq(returnAddr, 0) {
                revert(0, 0)
            }
        }
    }
}

/// @dev This is so we don't have to import ExchangeDeposit.
// etherscan verification API was including this test source file.
contract ExchangeDepositDummy {
    address payable public coldAddress;
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address recipient, uint256 amount)
        external
        returns (bool);
}

library SafeERC20 {
    function safeTransfer(
        IERC20 token,
        address recipient,
        uint256 amount
    ) internal {
        bytes memory data = abi.encodeWithSelector(
            token.transfer.selector,
            recipient,
            amount
        );
        (bool success, bytes memory returndata) = address(token).call{
            value: msg.value
        }(data);
        require(success, 'SafeERC20: low-level call failed');
        if (returndata.length > 0) {
            // Return data is optional
            require(abi.decode(returndata, (bool)), 'ERC20 did not succeed');
        }
    }
}
