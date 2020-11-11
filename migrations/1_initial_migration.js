const assert = require('assert');
const crypto = require('crypto');
const SampleLogic = artifacts.require('SampleLogic');
const ExchangeDeposit = artifacts.require('ExchangeDeposit');
const SimpleCoin = artifacts.require('SimpleCoin');
const ProxyFactory = artifacts.require('ProxyFactory');

module.exports = async (deployer, network, accounts) => {
  if (network === 'ropsten') {
    await deployer.deploy(ExchangeDeposit, accounts[0], accounts[1]);
    const exchangeDepositor = await ExchangeDeposit.deployed();
    console.log(
      `exchangeDepositor: https://ropsten.etherscan.io/address/${exchangeDepositor.address}`,
    );
    await deployer.deploy(ProxyFactory, exchangeDepositor.address);
    const proxyFactory = await ProxyFactory.deployed();
    console.log(
      `     proxyFactory: https://ropsten.etherscan.io/address/${proxyFactory.address}`,
    );

    const salt = '0x' + crypto.randomBytes(32).toString('hex');
    const contractAddr = await proxyFactory.deployNewInstance.call(salt);
    const tx = await proxyFactory.deployNewInstance(salt);
    assertRes(tx);
    console.log(
      `            proxy: https://ropsten.etherscan.io/address/${contractAddr}`,
    );
    process.exit(0);
  } else if (network === 'development') {
    await deployer.deploy(SampleLogic, { from: accounts[9] });
    await deployer.deploy(ExchangeDeposit, accounts[0], accounts[1], {
      from: accounts[9],
    });
    const exchangeDepositor = await ExchangeDeposit.deployed();

    await deployer.deploy(ProxyFactory, exchangeDepositor.address, {
      from: accounts[9],
    });
    await deployer.deploy(SimpleCoin, { from: accounts[9] });
  }
};

const assertRes = res => {
  assert.equal(((res || {}).receipt || res || {}).status, true);
};
