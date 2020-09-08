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
- `deployNewInstance(bytes32)` is called to create a new `Proxy` (one per user) that points to `ExchangeDeposit`.
- `changeImplAddress(address)` is called to change the `address implementation` of the 
`ExchangeDeposit` contract. Once this is non-zero, any fallback calls will be forwarded using 
DELEGATECALL to allow for adding new logic to the contract afterwards.
- `Proxy` was written in bytecode to optimize for deploy gas cost. An explanation is 
in a large comment below the main contract code. It relays the call using CALL if msg.data 
is null, but uses DELEGATECALL if msg.data is not-null. This way I can call `gatherErc20(address)` 
on the proxy contract in order to gather ERC20 tokens from the `Proxy`. We can also gather other 
assets given to the `Proxy` after the fact by changing `address implementation`.
- `kill()` will stop all deposits and stop DELEGATECALL to upgraded contract(s). 
gatherErc20 and gatherEth will forward to the `address adminAddress`.
(Since we can't refuse ERC20 payments, and a `selfdestruct` somewhere could give funds to 
a deposit address, and we should be able to recover it somehow.

### Run tests (requires docker-compose)

```bash
$ npm install
$ npm run build
$ npm test
```

## Contracts
- `contracts` folder contains the contracts with NatSpec documentation.

### build

```bash
$ npm run build
```

### deploy

`exchangeDepositor` がメインのロジックで `proxy` が顧客入金アドレス。
数分掛かる可能性があります。
`truffle-config.js`にて`networks.ropsten.gasPrice`を最新の状況に合わせて下さい。

```bash
$ ROPSTEN_MNEMONIC="MNEMONIC HERE" ROPSTEN_PROVIDER="wss://ropsten.infura.io/ws/v3/<PROJECT_KEY>" npm run deploy:ropsten
Compiling your contracts...
===========================
> Everything is up to date, there is nothing to compile.

exchangeDepositor: https://ropsten.etherscan.io/address/0xF22ed8067071e28B5aB0A95dFDE1bB6e5019B98a
            proxy: https://ropsten.etherscan.io/address/0xcffe98ea12329216Ebd7f88B7099D2a4bAE51dcB
```
