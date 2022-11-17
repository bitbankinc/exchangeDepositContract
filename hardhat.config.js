require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-web3');
require('solidity-coverage');
require('./tasks/deploy-contract');
require('./tasks/deploy-proxy');

module.exports = {
  networks: {
    hardhat: {
      accounts: {
        mnemonic:
          process.env.HARDHAT_MNEMONIC ||
          'absorb surface step floor dance acid run math mean word taxi bottom',
        hardfork: 'istanbul',
        accountsBalance: '1000000000000000000000000000',
      },
    },
    goerli: {
      url: process.env.GOERLI_ENDPOINT || 'INVALIDENDPOINT',
      accounts: process.env.GOERLI_MNEMONIC
        ? {
            mnemonic: process.env.GOERLI_MNEMONIC,
          }
        : undefined,
      gas: parseInt(process.env.GOERLI_GAS) || 'auto',
      gasPrice: parseInt(process.env.GOERLI_GASPRICE) || 'auto',
      gasMultiplier: parseFloat(process.env.GOERLI_GASMULTIPLIER) || 1,
    },
    mainnet: {
      url: process.env.MAINNET_ENDPOINT || 'INVALIDENDPOINT',
      accounts: process.env.MAINNET_MNEMONIC
        ? {
            mnemonic: process.env.MAINNET_MNEMONIC,
          }
        : undefined,
      gas: parseInt(process.env.MAINNET_GAS) || 'auto',
      gasPrice: parseInt(process.env.MAINNET_GASPRICE) || 'auto',
      gasMultiplier: parseFloat(process.env.MAINNET_GASMULTIPLIER) || 1,
    },
  },
  solidity: {
    version: '0.6.11',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: 'istanbul',
      outputSelection: {
        '*': {
          '*': [
            'abi',
            'evm.bytecode',
            'evm.deployedBytecode',
            'evm.methodIdentifiers',
          ],
          '': ['ast'],
        },
      },
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_APIKEY || 'DUMMY',
  },
};
