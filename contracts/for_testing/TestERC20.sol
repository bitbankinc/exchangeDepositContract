// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Custom Errors
error SafeERC20LowLevelCallFailed();
error ERC20CallNotSuccessful();

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);
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
        (bool success, bytes memory returndata) = address(token).call(data);
        if (!success) revert SafeERC20LowLevelCallFailed();
        if (returndata.length > 0) {
            // Return data is optional
            if (!abi.decode(returndata, (bool)))
                revert ERC20CallNotSuccessful();
        }
    }
}
