// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.11;

/**
 * @title ExchangeDeposit
 * @author Jonathan Underwood
 * @notice The main contract logic for centralized exchange deposit backend.
 * @dev This contract is the main contract that will generate the proxies, and
 * all proxies will go through this. There should only be one deployed.
 */
contract ExchangeDeposit {
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
     * @notice The address that can kill the contract
     * @dev This is only set in ExchangeDeposit (this) contract's storage.
     * It has the ability to kill the contract and disable logic forwarding,
     * and change the coldAddress and implementation address storages.
     */
    address payable public immutable adminAddress;

    /**
     * @notice Create the contract, and sets the destination address.
     * @param coldAddr See storage coldAddress
     * @param adminAddr See storage adminAddress
     */
    constructor(address payable coldAddr, address payable adminAddr) public {
        validateAddress(coldAddr);
        validateAddress(adminAddr);
        coldAddress = coldAddr;
        adminAddress = adminAddr;
    }

    /**
     * @notice Deposit event, used to log deposits sent from the Forwarder contract
     * @param receiver The proxy address from which funds were forwarded
     * @param amount The amount which was forwarded
     */
    event Deposit(address indexed receiver, uint256 amount);

    /**
     * @dev Internal function for validating addresses.
     * Throws if the address is 0x0
     * @param addr the address to validate
     */
    function validateAddress(address payable addr) internal pure {
        if (addr == address(0)) {
            revert('0x0 is an invalid address');
        }
    }

    /**
     * @dev isContract checks the extcodesize of the account to make sure
     * it is a smart contract.
     * @param account The address for checking if it is a contract.
     * @return true if contract, false if not
     */
    function isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }

    /**
     * @dev Internal function for getting the implementation address.
     * This is needed because we don't know whether the current context is
     * the ExchangeDeposit contract or a proxy contract. We deduce this by
     * whether exchangeDepositor address is 0x0 or not.
     * @return implementation address of the system
     */
    function getImplAddress() internal view returns (address payable) {
        address payable exDepositorAddr = exchangeDepositor();
        return
            exDepositorAddr == address(0)
                ? implementation
                : ExchangeDeposit(exDepositorAddr).implementation();
    }

    /**
     * @dev Internal function for getting the sendTo address for gathering ERC20/ETH.
     * If the contract is dead, they will be forwarded to the adminAddress.
     * @return The address for sending ERC20/ETH
     */
    function getSendAddress() internal view returns (address payable) {
        // If exchangeDepositor doesn't exist we're the ExchangeDeposit contract
        // If not, we are the Proxy contract, and can use exchangeDepositor
        address payable exDepositorAddr = exchangeDepositor();
        ExchangeDeposit exDepositor = exDepositorAddr == address(0)
            ? ExchangeDeposit(this)
            : ExchangeDeposit(exDepositorAddr);
        // Use exDepositor to perform logic for finding send address
        address payable coldAddr = exDepositor.coldAddress();
        address payable toAddr = coldAddr == address(0)
            ? exDepositor.adminAddress()
            : coldAddr;
        return toAddr;
    }

    /**
     * @dev Modifier that will execute internal code block only if the sender is the specified account
     */
    modifier onlyWith(address payable addr) {
        if (msg.sender != addr) {
            revert('Unauthorized caller');
        }
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if not killed
     */
    modifier onlyAlive {
        address payable exDepositorAddr = exchangeDepositor();
        address payable coldAddr = exDepositorAddr == address(0)
            ? coldAddress
            : ExchangeDeposit(exDepositorAddr).coldAddress();
        if (coldAddr == address(0)) {
            revert('I am dead :-(');
        }
        _;
    }

    /**
     * @dev Modifier that will execute internal code block only if called directly
     * (Not via proxy delegatecall)
     */
    modifier onlyExchangeDepositor {
        /// @dev exchangeDepositor is null when we are ExchangeDeposit
        if (exchangeDepositor() != address(0)) {
            revert('Calling Wrong Contract');
        }
        _;
    }

    /**
     * @notice exchangeDepositor is the address to which the proxy will forward.
     * @dev Any address that is not a proxy will return 0x0 address.
     * @return returnAddr The address the proxy forwards to.
     */
    function exchangeDepositor()
        public
        view
        returns (address payable returnAddr)
    {
        assembly {
            let me := address()
            let mysize := extcodesize(me)
            // The deployed code is 64 bytes, this check is quick.
            if eq(mysize, 64) {
                let ptr := mload(0x40)
                // We want to be secure, so check if the code 100% matches our code.
                extcodecopy(me, ptr, 0, mysize)
                // bytes [1:21) are a dynamic address, so mask it away.
                // bytes [64:96) are irrelevant, so mask them away just in case.
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
     * @notice Execute a token transfer of the full balance from the proxy
     * to the designated recipient.
     * @dev Recipient is coldAddress if not killed, else adminAddress.
     * @param instance The address of the erc20 token contract
     */
    function gatherErc20(ERC20Interface instance) external {
        uint256 forwarderBalance = instance.balanceOf(address(this));
        if (forwarderBalance == 0) {
            return;
        }
        if (!instance.transfer(getSendAddress(), forwarderBalance)) {
            revert('Could not gather ERC20');
        }
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
        onlyWith(adminAddress)
    {
        validateAddress(newAddress);
        coldAddress = newAddress;
    }

    /**
     * @notice Change implementation to newAddress.
     * @param newAddress the new address for implementation
     */
    function changeImplAddress(address payable newAddress)
        external
        onlyExchangeDepositor
        onlyAlive
        onlyWith(adminAddress)
    {
        require(
            newAddress == address(0) || isContract(newAddress),
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
        onlyWith(adminAddress)
    {
        minimumInput = newMinInput;
    }

    /**
     * @notice Sets coldAddress to 0, killing the forwarding and logging.
     */
    function kill()
        external
        onlyExchangeDepositor
        onlyAlive
        onlyWith(adminAddress)
    {
        coldAddress = address(0);
    }

    /**
     * @dev This deploys an extremely minimalist proxy contract that
     * deploys the contract with the current context address embedded within.
     * Note: I will explain the bytecode in comments below this contract.
     * @return returnAddr The new contract address.
     */
    function deployNewInstance(bytes32 salt)
        external
        returns (address payable returnAddr)
    {
        assembly {
            let ptr := mload(0x40)
            // so the address lines up with the beginning of add(ptr, 0x20)
            mstore(add(ptr, 0x14), address())
            mstore(ptr, 0x604080600a3d393df3fe73)
            mstore(
                add(ptr, 0x34),
                0x3d366025573d3d3d3d34865af16031565b363d3d373d3d363d855af45b3d8280
            )
            mstore(
                add(ptr, 0x54),
                0x3e603c573d81fd5b3d81f3000000000000000000000000000000000000000000
            )
            returnAddr := create2(0, add(ptr, 0x15), 74, salt)
            // If the same salt is used twice, it will fail, and the
            // memory at returnAddr will be 0x0
            if eq(returnAddr, 0) {
                revert(0, 0)
            }
        }
    }

    /**
     * @notice Forward any ETH value to the coldAddress
     * @dev This receive() type fallback means msg.data will be empty.
     * We disable deposits when dead.
     * Security note: Check the event forward address
     */
    receive() external payable {
        assembly {
            // STEP 1: Check if coldAddress is 0x0.
            // since we know msg.data is empty, that means the proxy uses CALL
            // which means we know the context is this contract.
            let cold := sload(0)
            if eq(cold, 0) {
                // coldAddress is zero Revert with "I am dead :-("

                // encodeFunctionSignature('Error(string)')
                mstore(
                    0x00,
                    0x08c379a000000000000000000000000000000000000000000000000000000000
                )

                // encodeParameter('string', 'I am dead :-(')
                // gives a 96 byte string, encoded in 3 chunks of 32 bytes below

                // offset
                mstore(0x04, 0x20)
                // "I am dead :-(" length
                mstore(0x24, 0x0d)
                // "I am dead :-(" right padded ASCII bytes
                mstore(
                    0x44,
                    0x4920616d2064656164203a2d2800000000000000000000000000000000000000
                )
                // Revert with the memory area we just loaded into.
                revert(0, 0x64)
            }

            // STEP 2: If callvalue is less than minimumInput, Revert.
            if lt(callvalue(), sload(1)) {
                // The deposit amount is too small. Revert with "Amount too small"

                // encodeFunctionSignature('Error(string)')
                mstore(
                    0x00,
                    0x08c379a000000000000000000000000000000000000000000000000000000000
                )

                // encodeParameter('string', 'Amount too small')
                // gives a 96 byte string, encoded in 3 chunks of 32 bytes below

                // offset
                mstore(0x04, 0x20)
                // "Amount too small" length
                mstore(0x24, 0x10)
                // "Amount too small" right padded ASCII bytes
                mstore(
                    0x44,
                    0x416d6f756e7420746f6f20736d616c6c00000000000000000000000000000000
                )
                // Revert with the memory area we just loaded into.
                revert(0, 0x64)
            }

            // STEP 3: Send the funds to the coldAddress
            if iszero(call(gas(), cold, callvalue(), 0, 0, 0, 0)) {
                // call() returns 0 on failure
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            // call() was a success
            // STEP 4: Emit the event. Equivalent to:
            // emit Deposit(msg.sender, msg.value)

            // get free memory pointer
            let ptr := mload(0x40)
            // first non-indexed value is msg.value
            mstore(ptr, callvalue())
            log2(
                ptr,
                0x20,
                // topic0 for
                // event Deposit(address indexed receiver, uint256 amount);
                0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c,
                // topic1 is first indexed value, receiver
                caller()
            )
        }
    }

    /**
     * @notice Forward commands to supplemental implementation address.
     * @dev This fallback() type fallback will be called when there is some
     * call data, and this contract is alive.
     * It forwards to the implementation contract via DELEGATECALL.
     */
    fallback() external payable onlyAlive {
        address payable toAddr = getImplAddress();
        assembly {
            if eq(toAddr, 0) {
                revert(0, 0)
            }
            // Load calldata into memory starting from the next free memory space
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            // perform DELEGATECALL
            let result := delegatecall(gas(), toAddr, ptr, calldatasize(), 0, 0)

            // Copy the returned data.
            returndatacopy(0, 0, returndatasize())

            switch result
                // callcode returns 0 on error.
                case 0 {
                    revert(0, returndatasize())
                }
                default {
                    return(0, returndatasize())
                }
        }
    }
}

/*
    // STORE CONTRACT CODE IN MEMORY, THEN RETURN IT
    POS | OPCODE |  OPCODE TEXT      |  STACK                               |
    00  |  6040  |  PUSH1 0x40       |  0x40                                |
    02  |  80    |  DUP1             |  0x40 0x40                           |
    03  |  600a  |  PUSH1 0x0a       |  0x0a 0x40 0x40                      |
    05  |  3d    |  RETURNDATASIZE   |  0x0 0x0a 0x40 0x40                  |
    06  |  39    |  CODECOPY         |  0x40                                |
    07  |  3d    |  RETURNDATASIZE   |  0x0 0x40                            |
    08  |  f3    |  RETURN           |                                      |

    09  |  fe    |  INVALID          |                                      |

    // START CONTRACT CODE

    // If msg.data length === 0, Jump to 0x16
    POS | OPCODE |  OPCODE TEXT      |  STACK                               |
    00  |  73... |  PUSH20 ...       |  {ADDR}                              |
    15  |  3d    |  RETURNDATASIZE   |  0x0 {ADDR}                          |
    16  |  36    |  CALLDATASIZE     |  CDS 0x0 {ADDR}                      |
    17  |  6025  |  PUSH1 0x25       |  0x25 CDS 0x0 {ADDR}                 |
    19  |  57    |  JUMPI            |  0x0 {ADDR}                          |

    // If msg.data === 0, CALL into address
    // This way, the proxy contract address becomes msg.sender and we can use
    // msg.sender in the Deposit Event
    POS | OPCODE |  OPCODE TEXT      |  STACK                                       |
    1A  |  3d    |  RETURNDATASIZE   |  0x0 0x0 {ADDR}                              |
    1B  |  3d    |  RETURNDATASIZE   |  0x0 0x0 0x0 {ADDR}                          |
    1C  |  3d    |  RETURNDATASIZE   |  0x0 0x0 0x0 0x0 {ADDR}                      |
    1D  |  3d    |  RETURNDATASIZE   |  0x0 0x0 0x0 0x0 0x0 {ADDR}                  |
    1E  |  34    |  CALLVALUE        |  VALUE 0x0 0x0 0x0 0x0 0x0 {ADDR}            |
    1F  |  86    |  DUP7             |  {ADDR} VALUE 0x0 0x0 0x0 0x0 0x0 {ADDR}     |
    20  |  5a    |  GAS              |  GAS {ADDR} VALUE 0x0 0x0 0x0 0x0 0x0 {ADDR} |
    21  |  f1    |  CALL             |  {RES} 0x0 {ADDR}                            |
    22  |  6031  |  PUSH1 0x31       |  0x31 {RES} 0x0 {ADDR}                       |
    24  |  56    |  JUMP             |  {RES} 0x0 {ADDR}                            |

    // If msg.data > 0, DELEGATECALL into address
    POS | OPCODE |  OPCODE TEXT      |  STACK                                 |
    25  |  5b    |  JUMPDEST         |  0x0 {ADDR}                            |
    26  |  36    |  CALLDATASIZE     |  CDS 0x0 {ADDR}                        |
    27  |  3d    |  RETURNDATASIZE   |  0x0 CDS 0x0 {ADDR}                    |
    28  |  3d    |  RETURNDATASIZE   |  0x0 0x0 CDS 0x0 {ADDR}                |
    29  |  37    |  CALLDATACOPY     |  0x0 {ADDR}                            |
    2A  |  3d    |  RETURNDATASIZE   |  0x0 0x0 {ADDR}                        |
    2B  |  3d    |  RETURNDATASIZE   |  0x0 0x0 0x0 {ADDR}                    |
    2C  |  36    |  CALLDATASIZE     |  CDS 0x0 0x0 0x0 {ADDR}                |
    2D  |  3d    |  RETURNDATASIZE   |  0x0 CDS 0x0 0x0 0x0 {ADDR}            |
    2E  |  85    |  DUP6             |  {ADDR} 0x0 CDS 0x0 0x0 0x0 {ADDR}     |
    2F  |  5a    |  GAS              |  GAS {ADDR} 0x0 CDS 0x0 0x0 0x0 {ADDR} |
    30  |  f4    |  DELEGATECALL     |  {RES} 0x0 {ADDR}                      |

    // We take the result of the call, load in the returndata,
    // If call result == 0, failure, revert
    // else success, return
    // (Left the extra 0x00 on the stack so I can use DUP instead of PUSH)
    POS | OPCODE |  OPCODE TEXT      |  STACK                               |
    31  |  5b    |  JUMPDEST         |  {RES} 0x0 {ADDR}                    |
    32  |  3d    |  RETURNDATASIZE   |  RDS {RES} 0x0 {ADDR}                |
    33  |  82    |  DUP3             |  0x0 RDS {RES} 0x0 {ADDR}            |
    34  |  80    |  DUP1             |  0x0 0x0 RDS {RES} 0x0 {ADDR}        |
    35  |  3e    |  RETURNDATACOPY   |  {RES} 0x0 {ADDR}                    |
    36  |  603c  |  PUSH1 0x3c       |  0x3c {RES} 0x0 {ADDR}               |
    38  |  57    |  JUMPI            |  0x0 {ADDR}                          |
    39  |  3d    |  RETURNDATASIZE   |  RDS 0x0 {ADDR}                      |
    3A  |  81    |  DUP2             |  0x0 RDS 0x0 {ADDR}                  |
    3B  |  fd    |  REVERT           |  0x0 {ADDR}                          |
    3C  |  5b    |  JUMPDEST         |  0x0 {ADDR}                          |
    3D  |  3d    |  RETURNDATASIZE   |  RDS 0x0 {ADDR}                      |
    3E  |  81    |  DUP2             |  0x0 RDS 0x0 {ADDR}                  |
    3F  |  f3    |  RETURN           |  0x0 {ADDR}                          |
*/

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface ERC20Interface {
    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     * @dev Returns a boolean value indicating whether the operation succeeded.
     * @dev Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount)
        external
        returns (bool);
}