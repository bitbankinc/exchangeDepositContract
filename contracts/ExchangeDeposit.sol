// SPDX-License-Identifier: MIT
pragma solidity 0.6.11;
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/utils/Address.sol';

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
    address payable public immutable adminAddress;
    /**
     * @dev The address of this ExchangeDeposit instance. This is used
     * for discerning whether we are a Proxy or an ExchangeDepsosit.
     */
    address payable private immutable thisAddress;

    /**
     * @notice Create the contract, and sets the destination address.
     * @param coldAddr See storage coldAddress
     * @param adminAddr See storage adminAddress
     */
    constructor(address payable coldAddr, address payable adminAddr) public {
        require(coldAddr != address(0), '0x0 is an invalid address');
        require(adminAddr != address(0), '0x0 is an invalid address');
        coldAddress = coldAddr;
        adminAddress = adminAddr;
        thisAddress = address(this);
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
        return thisAddress == address(this);
    }

    /**
     * @dev Get an instance of ExchangeDeposit for the main contract
     * @return ExchangeDeposit instance (main contract of the system)
     */
    function getExchangeDepositor() internal view returns (ExchangeDeposit) {
        // If this context is ExchangeDeposit, use `this`, else use exDepositorAddr
        return isExchangeDepositor() ? this : ExchangeDeposit(thisAddress);
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
                : ExchangeDeposit(thisAddress).implementation();
    }

    /**
     * @dev Internal function for getting the sendTo address for gathering ERC20/ETH.
     * If the contract is dead, they will be forwarded to the adminAddress.
     * @return address payable for sending ERC20/ETH
     */
    function getSendAddress() internal view returns (address payable) {
        ExchangeDeposit exDepositor = getExchangeDepositor();
        // Use exDepositor to perform logic for finding send address
        address payable coldAddr = exDepositor.coldAddress();
        // If ExchangeDeposit is killed, use adminAddress, else use coldAddress
        address payable toAddr =
            coldAddr == address(0) ? exDepositor.adminAddress() : coldAddr;
        return toAddr;
    }

    /**
     * @dev Modifier that will execute internal code block only if the sender is the specified account
     */
    modifier onlyAdmin {
        require(msg.sender == adminAddress, 'Unauthorized caller');
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if not killed
     */
    modifier onlyAlive {
        require(
            getExchangeDepositor().coldAddress() != address(0),
            'I am dead :-('
        );
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if called directly
     * (Not via proxy delegatecall)
     */
    modifier onlyExchangeDepositor {
        require(isExchangeDepositor(), 'Calling Wrong Contract');
        _;
    }

    /**
     * @notice Execute a token transfer of the full balance from the proxy
     * to the designated recipient.
     * @dev Recipient is coldAddress if not killed, else adminAddress.
     * @param instance The address of the erc20 token contract
     */
    function gatherErc20(IERC20 instance) external {
        uint256 forwarderBalance = instance.balanceOf(address(this));
        if (forwarderBalance == 0) {
            return;
        }
        instance.safeTransfer(getSendAddress(), forwarderBalance);
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
        require(result, 'Could not gather ETH');
    }

    /**
     * @notice Change coldAddress to newAddress.
     * @param newAddress the new address for coldAddress
     */
    function changeColdAddress(address payable newAddress)
        external
        onlyExchangeDepositor
        onlyAlive
        onlyAdmin
    {
        require(newAddress != address(0), '0x0 is an invalid address');
        coldAddress = newAddress;
    }

    /**
     * @notice Change implementation to newAddress.
     * @dev newAddress can be address(0) (to disable extra implementations)
     * @param newAddress the new address for implementation
     */
    function changeImplAddress(address payable newAddress)
        external
        onlyExchangeDepositor
        onlyAlive
        onlyAdmin
    {
        require(
            newAddress == address(0) || newAddress.isContract(),
            'implementation must be contract'
        );
        implementation = newAddress;
    }

    /**
     * @notice Change minimumInput to newMinInput.
     * @param newMinInput the new minimumInput
     */
    function changeMinInput(uint256 newMinInput)
        external
        onlyExchangeDepositor
        onlyAlive
        onlyAdmin
    {
        minimumInput = newMinInput;
    }

    /**
     * @notice Sets coldAddress to 0, killing the forwarding and logging.
     */
    function kill() external onlyExchangeDepositor onlyAlive onlyAdmin {
        coldAddress = address(0);
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
        // Using a simplified version of onlyAlive
        // since we know that any call here has no calldata
        // this saves a large amount of gas due to the fact we know
        // that this can only be called from the ExchangeDeposit context
        require(coldAddress != address(0), 'I am dead :-(');
        require(msg.value >= minimumInput, 'Amount too small');
        (bool success, ) = coldAddress.call{ value: msg.value }('');
        require(success, 'Forwarding funds failed');
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
        require(toAddr != address(0), 'Fallback contract not set');
        (bool success, ) = toAddr.delegatecall(msg.data);
        require(success, 'Fallback contract failed');
    }
}
