// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { Address } from '@openzeppelin/contracts/utils/Address.sol';

// Custom Errors
error InvalidAddress(address addr);
error UnauthorizedCaller(address caller, address expected);
error ContractIsDead();
error CallingWrongContract();
error EthGatherFailed();
error ImplementationNotAContract(address addr);
error AmountTooSmall(uint256 sent, uint256 minimum);
error EthForwardFailed();
error FallbackContractNotSet();
error FallbackContractFailed();

/**
 * @title ExchangeDeposit
 * @author Jonathan Underwood
 * @notice The main contract logic for centralized exchange deposit backend.
 * @dev This contract is the main contract that will generate the proxies, and
 * all proxies will go through this. There should only be one deployed.
 */
contract ExchangeDeposit {
    using SafeERC20 for IERC20;
    using Address for address payable;
    /**
     * @notice Address to which any funds sent to this contract will be forwarded
     * @dev This is only set in ExchangeDeposit (this) contract's storage.
     * It should be cold.
     */
    address payable public coldAddress;
    /**
     * @notice The minimum wei amount of deposit to allow.
     * @dev This attribute is required for all future versions, as it is
     * accessed directly from ExchangeDeposit
     */
    uint256 public minimumInput = 1e16; // 0.01 ETH
    /**
     * @notice The address with the implementation of further upgradable logic.
     * @dev This is only set in ExchangeDeposit (this) contract's storage.
     * Also, forwarding logic to this address via DELEGATECALL is disabled when
     * this contract is killed (coldAddress == address(0)).
     * Note, it must also have the same storage structure.
     */
    address payable public implementation;
    /**
     * @notice The address that can manage the contract storage (and kill it).
     * @dev This is only set in ExchangeDeposit (this) contract's storage.
     * It has the ability to kill the contract and disable logic forwarding,
     * and change the coldAddress and implementation address storages.
     */
    address payable public immutable ADMIN_ADDRESS;
    /**
     * @dev The address of this ExchangeDeposit instance. This is used
     * for discerning whether we are a Proxy or an ExchangeDepsosit.
     */
    address payable private immutable THIS_ADDRESS;

    /**
     * @notice Create the contract, and sets the destination address.
     * @param coldAddr See storage coldAddress
     * @param adminAddr See storage ADMIN_ADDRESS
     */
    constructor(address payable coldAddr, address payable adminAddr) {
        if (coldAddr == address(0)) revert InvalidAddress(coldAddr);
        if (adminAddr == address(0)) revert InvalidAddress(adminAddr);
        coldAddress = coldAddr;
        ADMIN_ADDRESS = adminAddr;
        THIS_ADDRESS = payable(address(this));
    }

    /**
     * @notice Deposit event, used to log deposits sent from the Forwarder contract
     * @dev We don't need to log coldAddress because the event logs and storage
     * are always the same context, so as long as we are checking the correct
     * account's event logs, no one should be able to set off events using
     * DELEGATECALL trickery.
     * @param receiver The proxy address from which funds were forwarded
     * @param amount The amount which was forwarded
     */
    event Deposit(address indexed receiver, uint256 amount);

    /**
     * @dev This internal function checks if the current context is the main
     * ExchangeDeposit contract or one of the proxies.
     * @return bool of whether or not this is ExchangeDeposit
     */
    function isExchangeDepositor() internal view returns (bool) {
        return THIS_ADDRESS == address(this);
    }

    /**
     * @dev Get an instance of ExchangeDeposit for the main contract
     * @return ExchangeDeposit instance (main contract of the system)
     */
    function getExchangeDepositor() internal view returns (ExchangeDeposit) {
        // If this context is ExchangeDeposit, use `this`, else use exDepositorAddr
        return isExchangeDepositor() ? this : ExchangeDeposit(THIS_ADDRESS);
    }

    /**
     * @dev Internal function for getting the implementation address.
     * This is needed because we don't know whether the current context is
     * the ExchangeDeposit contract or a proxy contract.
     * @return implementation address of the system
     */
    function getImplAddress() internal view returns (address payable) {
        return
            isExchangeDepositor()
                ? implementation
                : ExchangeDeposit(THIS_ADDRESS).implementation();
    }

    /**
     * @dev Internal function for getting the sendTo address for gathering ERC20/ETH.
     * If the contract is dead, they will be forwarded to the ADMIN_ADDRESS.
     * @return address payable for sending ERC20/ETH
     */
    function getSendAddress() internal view returns (address payable) {
        ExchangeDeposit exDepositor = getExchangeDepositor();
        // Use exDepositor to perform logic for finding send address
        address payable coldAddr = exDepositor.coldAddress();
        // If ExchangeDeposit is killed, use ADMIN_ADDRESS, else use coldAddress
        address payable toAddr = coldAddr == address(0)
            ? exDepositor.ADMIN_ADDRESS()
            : coldAddr;
        return toAddr;
    }

    /**
     * @dev Modifier that will execute internal code block only if the sender is the specified account
     */
    modifier onlyAdmin() {
        if (msg.sender != ADMIN_ADDRESS)
            revert UnauthorizedCaller(msg.sender, ADMIN_ADDRESS);
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if not killed
     */
    modifier onlyAlive() {
        if (getExchangeDepositor().coldAddress() == address(0))
            revert ContractIsDead();
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if called directly
     * (Not via proxy delegatecall)
     */
    modifier onlyExchangeDepositor() {
        if (!isExchangeDepositor()) revert CallingWrongContract();
        _;
    }

    /**
     * @notice Execute a token transfer of the full balance from the proxy
     * to the designated recipient.
     * @dev Recipient is coldAddress if not killed, else ADMIN_ADDRESS.
     * @param instance The address of the erc20 token contract
     */
    function gatherErc20(IERC20 instance) external {
        uint256 forwarderBalance = instance.balanceOf(address(this));
        if (forwarderBalance == 0) {
            return;
        }
        address payable sendAddr = getSendAddress(); // Cache the address
        instance.safeTransfer(sendAddr, forwarderBalance);
    }

    /**
     * @notice Gather any ETH that might have existed on the address prior to creation
     * @dev It is also possible our addresses receive funds from another contract's
     * selfdestruct.
     */
    function gatherEth() external {
        uint256 balance = address(this).balance;
        if (balance == 0) {
            return;
        }
        (bool result, ) = getSendAddress().call{ value: balance }('');
        if (!result) revert EthGatherFailed();
    }

    /**
     * @notice Change coldAddress to newAddress.
     * @param newAddress the new address for coldAddress
     */
    function changeColdAddress(
        address payable newAddress
    ) external onlyExchangeDepositor onlyAlive onlyAdmin {
        if (newAddress == address(0)) revert InvalidAddress(newAddress);
        coldAddress = newAddress;
    }

    /**
     * @notice Change implementation to newAddress.
     * @dev newAddress can be address(0) (to disable extra implementations)
     * @param newAddress the new address for implementation
     */
    function changeImplAddress(
        address payable newAddress
    ) external onlyExchangeDepositor onlyAlive onlyAdmin {
        if (newAddress != address(0) && !newAddress.isContract())
            revert ImplementationNotAContract(newAddress);
        implementation = newAddress;
    }

    /**
     * @notice Change minimumInput to newMinInput.
     * @param newMinInput the new minimumInput
     */
    function changeMinInput(
        uint256 newMinInput
    ) external onlyExchangeDepositor onlyAlive onlyAdmin {
        minimumInput = newMinInput;
    }

    /**
     * @notice Sets coldAddress to 0, killing the forwarding and logging.
     */
    function kill() external onlyExchangeDepositor onlyAlive onlyAdmin {
        coldAddress = payable(address(0));
    }

    /**
     * @notice Forward any ETH value to the coldAddress
     * @dev This receive() type fallback means msg.data will be empty.
     * We disable deposits when dead.
     * Security note: Every time you check the event log for deposits,
     * also check the coldAddress storage to make sure it's pointing to your
     * cold account.
     */
    receive() external payable {
        address payable localColdAddress = coldAddress; 
        uint256 localMinimumInput = minimumInput; 

        if (localColdAddress == address(0)) revert ContractIsDead();
        if (msg.value < localMinimumInput)
            revert AmountTooSmall(msg.value, localMinimumInput);
        
        (bool success, ) = localColdAddress.call{ value: msg.value }('');
        if (!success) revert EthForwardFailed();
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Forward commands to supplemental implementation address.
     * @dev This fallback() type fallback will be called when there is some
     * call data, and this contract is alive.
     * It forwards to the implementation contract via DELEGATECALL.
     */
    fallback() external payable onlyAlive {
        address payable toAddr = getImplAddress();
        if (toAddr == address(0)) revert FallbackContractNotSet();
        (bool success, ) = toAddr.delegatecall(msg.data);
        if (!success) revert FallbackContractFailed();
    }
}
