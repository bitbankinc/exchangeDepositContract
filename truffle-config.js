const HDWalletProvider = require('@truffle/hdwallet-provider');

const ropstenGasPrice = process.env['ROPSTEN_GASPRICE']
  ? parseInt(process.env['ROPSTEN_GASPRICE'])
  : 80000000000; // in wei

module.exports = {
  networks: {
    development: {
      host: '127.0.0.1',
      port: 19382,
      network_id: 47934673,
    },
    ropsten: {
      provider: () =>
        new HDWalletProvider(
          process.env['ROPSTEN_MNEMONIC'],
          process.env['ROPSTEN_PROVIDER'],
        ),
      network_id: 3,
      gas: 1100000,
      confirmations: 2,
      timeoutBlocks: 50,
      skipDryRun: true,
      gasPrice: ropstenGasPrice,
      websockets: true,
    },
  },
  plugins: ['solidity-coverage'],
  mocha: {
    timeout: 20000,
  },
  compilers: {
    solc: {
      version: '0.6.11',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: 'istanbul',
      },
    },
  },
};
