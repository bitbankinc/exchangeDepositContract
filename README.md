# Exchange Deposit Contract

## Goals

1. Optimize deploy gas usage for the per-user contracts.
2. Optimize run-time gas usage for the ETH deposit to deposit address path.
This should be kept below 42000 gas. (Since naive approaches would have 2 value
tx being sent, one from the customer, one forwarding to cold manually,
21000 x 2 = 42000... so we should be better than this)
3. Allow killing the contract. This will cause all ETH deposits to fail.
4. Support ERC20 deposits by creating a function to move them to the hard-coded
cold address. The gas cost for this should be somewhere in the 50k gas range.
5. If the contract is killed, ERC20 should be sent to the secondary backup kill
address... since we can't stop ERC20 deposits, we want to leave a path for
fund recovery if the user deposits to an old deposit address after it's been
killed.
- **Solidity Version:** ^0.8.20

## Structure

- `ExchangeDeposit` contract is the main contract. It is deployed first.
- `ProxyFactory` is the factory for generating proxies, it takes the address of the `ExchangeDeposit` instance as a constructor parameter.
- `deployNewInstance(bytes32)` is called on `ProxyFactory` to create a new `Proxy` (one per user) that points to `ExchangeDeposit`.
- `changeImplAddress(address)` is called on `ExchangeDeposit` to change the `address implementation` of the
`ExchangeDeposit` contract. Once this is non-zero, any fallback calls will be forwarded using
DELEGATECALL to allow for adding new logic to the contract afterwards.
- `Proxy` was written in bytecode to optimize for deploy gas cost. An explanation is
in a large comment below the main contract code. It relays the call using CALL if msg.data
is null, but uses DELEGATECALL if msg.data is not-null. This way we can call `gatherErc20(address)`
on the proxy contract in order to gather ERC20 tokens from the `Proxy`. We can also gather other
assets given to the `Proxy` after the fact by changing `address implementation`.
- `kill()` on `ExchangeDeposit` will stop all deposits and stop DELEGATECALL to upgraded contract(s).
gatherErc20 and gatherEth will forward to the `address adminAddress`.
(Since we can't refuse ERC20 payments, and a `selfdestruct` somewhere could give funds to
a deposit address, and we should be able to recover it somehow.
### Solidity 0.8 Upgrade Notes

This project was originally written for Solidity 0.6.11. It has been upgraded to ^0.8.20. Key changes included:

- Updated Solidity `pragma` statements in all contracts.
- Updated `hardhat.config.js` compiler version.
- Updated `@openzeppelin/contracts` dependency to `4.9.3`.
- Updated `prettier` dependency to `^2.8.8`.
- Fixed `address` to `address payable` explicit conversion errors introduced in Solidity 0.8+.
- Updated test file (`test/exchangedeposit.js`) assertions (`assert.rejects`) to match new revert reason string formats.
- Adjusted gas cost expectations in tests.
- **Note:** Due to older dependencies in the project structure, `npm install --legacy-peer-deps` is currently required to resolve peer dependency conflicts.



### Run tests

```bash
# Install dependencies (may need --legacy-peer-deps due to older package structure)
$ npm install --legacy-peer-deps
$ npm test
```

## Contracts
- `contracts` folder contains the contracts with NatSpec documentation.

### build

```bash
$ npm run build
```

### deploy

`exchangeDepositor` is the main logic contract and `proxy` is the
customer deposit contract. It will take a few minutes to deploy.
Add `SEPOLIA_GASPRICE=100000000000` to the command to set the gasPrice
to 100 gWei etc. (See hardhat.config.js for which ENV vars are set to which settings)

For Mainnet:
- Change all env vars from SEPOLIA_* to MAINNET_*
- Use npm run *:mainnet instead of npm run *:sepolia

```bash
# Use this command to get ENV vars without sending them to stdout
$ read -s -p "ENDPOINT? " SEPOLIA_ENDPOINT && \
  export SEPOLIA_ENDPOINT=$SEPOLIA_ENDPOINT && \
  echo ""
$ read -s -p "MNEMONIC? " SEPOLIA_MNEMONIC && \
  export SEPOLIA_MNEMONIC=$SEPOLIA_MNEMONIC && \
  echo ""

# Sepolia main contract
$ npm run deploy:sepolia -- \
  --contract ExchangeDeposit \
  --arguments '["COLDADDRESS","ADMINADDRESS"]'
# Sepolia ProxyFactory
$ npm run deploy:sepolia -- \
  --contract ProxyFactory \
  --arguments '["MAINCONTRACTADDRESS"]'
# Sepolia deploy proxy
$ npm run deploy-proxy:sepolia -- \
  --factory "PROXYFACTORYADDRESS"

# Verify on etherscan
# Needs ETHERSCAN_APIKEY and SEPOLIA_ENDPOINT
$ npx hardhat verify --network sepolia CONTRACTADDRESS "CONSTRUCTOR ARG 1" "ARG 2"
# Note: Uses @nomicfoundation/hardhat-verify plugin (successor to @nomiclabs/hardhat-etherscan)
# See: https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify
```

### usage

- Before checking the events of your `exchangeDepositContract`, double check to make sure
that the `coldAddress` attribute and the `implementation` attributes are what you expect them
to be. This will help your application recognize when someone might have tampered with your
contract's state.
- If the state has been tampered with, consider using the admin key to kill the system.
This will prevent users from depositing ETH. However, since ERC20 can not be prevented, the
address to which ERC20 tokens are forwarded to becomes the admin key (used to kill the contract).
- When calling `deployNewInstance` on `ProxyFactory` it is possible for people to front-run
your transaction. They are essentially generating the contract for you in a separate transaction,
causing your transaction to fail. This is not a problem, since failure costs less than success.
After noticing your transaction failure, call `getCode` on the expected contract address and
see if the code matches what you expect. (the 64 byte proxy bytecode with your `exchangeDepositContract`
address in it) If the code matches, then someone paid for your contract deployment, it doesn't
affect the security of the contract.
- Calling gatherErc20 is similar in gas usage to calling transfer from an EOA. It is a good
idea to call it once per proxy address when you've received tokens for them.
- Calling gatherEth should be irregular, as the only practical way you can receive ETH without an event
being triggered is if someone selfdestructs a contract and gives you its balance.
- The contract at implementation should have a similar storage structure to ExchangeDeposit,
since it will be DELEGATECALLed from the ExchangeDeposit contract.
