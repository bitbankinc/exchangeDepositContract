const HDWalletProvider = require('@truffle/hdwallet-provider');
module.exports = {
  networks: {
    development: {
      host: process.env['NODE_ENV'] === 'ci' ? 'ganachecli' : '127.0.0.1',
      port: process.env['NODE_ENV'] === 'ci' ? 8545 : 19382,
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
      gasPrice: 80000000000, // 80 gwei
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
