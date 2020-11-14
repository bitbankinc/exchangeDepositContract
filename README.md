# POC Ethereum Smart Contract Deposit

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

### Run tests

```bash
$ npm install
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
Add `ROPSTEN_GASPRICE=100000000000` to the command to set the gasPrice
to 100 gWei etc. (See hardhat.config.js for which ENV vars are set to which settings)

For Mainnet:
- Change all env vars from ROPSTEN_* to MAINNET_*
- Use npm run *:mainnet instead of npm run *:ropsten

```bash
# Use this command to get ENV vars without sending them to stdout
$ read -s -p "ENDPOINT? " ROPSTEN_ENDPOINT && \
  export ROPSTEN_ENDPOINT=$ROPSTEN_ENDPOINT && \
  echo ""
$ read -s -p "MNEMONIC? " ROPSTEN_MNEMONIC && \
  export ROPSTEN_MNEMONIC=$ROPSTEN_MNEMONIC && \
  echo ""

# ROPSTEN main contract
$ npm run deploy:ropsten -- \
  --contract ExchangeDeposit \
  --arguments '["COLDADDRESS","ADMINADDRESS"]'
# ROPSTEN ProxyFactory
$ npm run deploy:ropsten -- \
  --contract ProxyFactory \
  --arguments '["MAINCONTRACTADDRESS"]'
# ROPSTEN deploy proxy
$ npm run deploy-proxy:ropsten -- \
  --factory "PROXYFACTORYADDRESS"

# Verify on etherscan
# Needs ETHERSCAN_APIKEY and ROPSTEN_ENDPOINT
$ npx hardhat verify --network ropsten "CONTRACTADDRESS" "CONSTRUCTOR ARG 1" "ARG 2"
# Please see documentation for the plugin for hardhat etherscan
# https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html
```
