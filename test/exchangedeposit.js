const assert = require('assert');
const crypto = require('crypto');
const rlp = require('rlp');
const SampleLogic = artifacts.require('SampleLogic');
const ExchangeDeposit = artifacts.require('ExchangeDeposit'); // Truffle Artifact
const SimpleCoin = artifacts.require('SimpleCoin');
const SimpleBadCoin = artifacts.require('SimpleBadCoin');
const ProxyFactory = artifacts.require('ProxyFactory'); // Truffle Artifact
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const { expect } = require('chai'); // Added for custom error checking
const { ethers } = require('hardhat'); // Added for Ethers.js interaction
const { expectRevert } = require('@openzeppelin/test-helpers'); // Added for expectRevert

// Don't report gas if running coverage
// solidity-coverage gas costs are irregular
let DEPOSIT_GAS_MAX = 46000; // Increased threshold after 0.8 upgrade
if (process.env.npm_lifecycle_script === 'hardhat coverage') {
  console.log = () => {};
  DEPOSIT_GAS_MAX = 100000;
}

// tweak is for using the code of the SampleLogic (only for testing)
// the default tweak = false will return the bytecode for our proxy
const runtimeCode = (addr, prefix = '0x', tweak = false) =>
  `${prefix}73${addr}3d366025573d3d3d3d34865af16031565b363d3d373d3d363d855af45b3d82${
    tweak ? '83' : '80'
  }3e603c573d81fd5b3d81f3`;
const deployCode = (addr, prefix = '0x', tweak = false) =>
  `${prefix}604080600a3d393df3fe${runtimeCode(addr, '', tweak)}`;

contract('ExchangeDeposit', async (accounts) => {
  const COLD_ADDRESS = accounts[0];
  const ADMIN_ADDRESS = accounts[1];
  const COLD_ADDRESS2 = accounts[7];
  const ADMIN_ADDRESS2 = accounts[8];
  const FUNDER_ADDRESS = accounts[9]; // This is accounts[9]
  const from = FUNDER_ADDRESS;
  let exchangeDepositor,
    proxy,
    proxyFactory,
    sampleLogic,
    simpleCoin,
    simpleBadCoin,
    RAND_AMT;
  let ExchangeDepositFactoryEthers, ProxyFactoryFactoryEthers; // For Ethers.js factories
  let funderSigner; // For Ethers.js signer

  // Make sure the deployed addresses are always the same given the same nonce and account
  // (Sanity check)
  before(async () => {
    assert.equal(
      from,
      '0x9b720Bc8A3dd670A24D8BeB0923a45A324b94abD',
      'Mismatch of from address for tests',
    );
    const nonce = await web3.eth.getTransactionCount(from);
    assert.equal(nonce, 0, 'Please run the tests on a fresh hardhat network');
    const ex = await ExchangeDeposit.new(COLD_ADDRESS, ADMIN_ADDRESS, { from });
    const prf = await ProxyFactory.new(ex.address, { from });
    assert.equal(
      ex.address,
      '0x3F2ffaBc7bd3E4399E3d6Cf06c8eD09FED69b716',
      'Mismatch of deployed ExchangeDeposit contract address',
    );
    assert.equal(
      prf.address,
      '0xFdfe1787577c781D4C8764Af30269508790e4267',
      'Mismatch of deployed ProxyFactory contract address',
    );

    // Get Ethers.js contract factories
    ExchangeDepositFactoryEthers =
      await ethers.getContractFactory('ExchangeDeposit');
    ProxyFactoryFactoryEthers = await ethers.getContractFactory('ProxyFactory');
    const signers = await ethers.getSigners();
    funderSigner = signers[9]; // FUNDER_ADDRESS is accounts[9]
  });

  // Deploy a fresh batch of contracts for each test
  beforeEach(async () => {
    // Random amount string between 0.01 ETH and 0.5 ETH (in wei)
    RAND_AMT = randNumberString('10000000000000000', '500000000000000000');
    const deployed = await deploy(COLD_ADDRESS, ADMIN_ADDRESS, RAND_AMT);
    ({
      exchangeDepositor,
      proxy,
      proxyFactory,
      sampleLogic,
      simpleCoin,
      simpleBadCoin,
    } = deployed);
  });

  describe('Deploy and Attributes', async () => {
    it('should deploy', async () => {
      assert.equal(
        await getEmbeddedAddress(proxy.address),
        exchangeDepositor.address,
      );
    });

    it('should fail deploy if using 0x0 address for constructor', async () => {
      await expect(
        ExchangeDepositFactoryEthers.connect(funderSigner).deploy(
          exchangeDepositor.address,
          ZERO_ADDR,
        ),
      )
        .to.be.revertedWithCustomError(
          ExchangeDepositFactoryEthers,
          'InvalidAddress',
        )
        .withArgs(ZERO_ADDR);
      await expect(
        ExchangeDepositFactoryEthers.connect(funderSigner).deploy(
          ZERO_ADDR,
          exchangeDepositor.address,
        ),
      )
        .to.be.revertedWithCustomError(
          ExchangeDepositFactoryEthers,
          'InvalidAddress',
        )
        .withArgs(ZERO_ADDR);
    });

    it('should set attributes properly', async () => {
      assert.equal(await exchangeDepositor.coldAddress(), COLD_ADDRESS);
      assert.equal(
        await getEmbeddedAddress(exchangeDepositor.address),
        ZERO_ADDR,
      );
      assert.equal(await exchangeDepositor.ADMIN_ADDRESS(), ADMIN_ADDRESS);
      assert.equal(await exchangeDepositor.implementation(), ZERO_ADDR);
      assert.equal(await proxy.coldAddress(), ZERO_ADDR);
      assert.equal(
        await getEmbeddedAddress(proxy.address),
        exchangeDepositor.address,
      );
      // immutable references pull directly from logic code
      // so it will always be the same
      assert.equal(await proxy.ADMIN_ADDRESS(), ADMIN_ADDRESS);
      assert.equal(await proxy.implementation(), ZERO_ADDR);
    });

    it('should deploy the proper code for the proxy contract', async () => {
      const code = await web3.eth.getCode(proxy.address);
      const addr = exchangeDepositor.address.replace(/^0x/, '').toLowerCase();
      assert.equal(
        code,
        // This is the proxy contract bytecode, we check it in tests
        // to make sure we didn't accidentally change it.
        runtimeCode(addr),
      );
    });

    it('should revert if deploy called with the same salt twice', async () => {
      const salt = randSalt();
      assert.ok(await proxyFactory.deployNewInstance(salt, { from }));
      await assert.rejects(
        proxyFactory.deployNewInstance(salt, { from }),
        /Transaction reverted without a reason string$/,
      );
    });
  });

  describe('Gas costs', async () => {
    it('should have reasonable proxy deploy gas', async () => {
      const salt = randSalt();
      const tx = await proxyFactory.deployNewInstance(salt, {
        from,
      });
      assertRes(tx);
      console.log(
        `**********************  Proxy contract deploy gas used: ${tx.receipt.gasUsed}`,
      );
      assert.ok(tx.receipt.gasUsed <= 85000, 'Deploy gas too expensive');

      // Make sure it reverts when ZERO_ADDR is used to instanciate
      await expect(
        ProxyFactoryFactoryEthers.connect(funderSigner).deploy(ZERO_ADDR),
      )
        .to.be.revertedWithCustomError(
          ProxyFactoryFactoryEthers,
          'InvalidMainAddress',
        )
        .withArgs(ZERO_ADDR);
    });

    it('should have reasonable deposit gas', async () => {
      const tx = await sendCoins(proxy.address, RAND_AMT, from);
      assertRes(tx);
      console.log(
        `************************************  Deposit gas used: ${tx.gasUsed}`,
      );
      assert.ok(tx.gasUsed <= DEPOSIT_GAS_MAX, 'Deposit gas too expensive');
    });
  });

  describe('Deposit tracking', async () => {
    it('should forward funds properly', async () => {
      const proxyBalance1 = BigInt(await web3.eth.getBalance(proxy.address));
      const coldBalance1 = BigInt(await web3.eth.getBalance(COLD_ADDRESS));
      const fromBalance1 = BigInt(await web3.eth.getBalance(from));

      const tx = await sendCoins(proxy.address, RAND_AMT, from);
      assertRes(tx);
      const fee = BigInt(tx.gasUsed) * BigInt(await web3.eth.getGasPrice());

      const proxyBalance2 = BigInt(await web3.eth.getBalance(proxy.address));
      const coldBalance2 = BigInt(await web3.eth.getBalance(COLD_ADDRESS));
      const fromBalance2 = BigInt(await web3.eth.getBalance(from));

      assert.equal(proxyBalance1, proxyBalance2); // no change
      assert.equal(coldBalance2 - coldBalance1, BigInt(RAND_AMT)); // deposit amount
      assert.equal(coldBalance2 - coldBalance1, BigInt(RAND_AMT)); // Check that cold address received the correct amount
    });

    it('should fail if the cold address reverts', async () => {
      const res = await exchangeDepositor.changeColdAddress(
        sampleLogic.address,
        {
          from: ADMIN_ADDRESS,
        },
      );
      assertRes(res);
      await expect(
        sendCoins(proxy.address, RAND_AMT, from),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'EthForwardFailed',
      );
    });

    it('should gather ERC20 funds properly', async () => {
      const bal = await simpleCoin.balanceOf(proxy.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const res = await proxy.gatherErc20(simpleCoin.address);
      assertRes(res);
      console.log(
        `***************************** Gas used gathering ERC20: ${res.receipt.gasUsed}`,
      );

      const bal2 = await simpleCoin.balanceOf(COLD_ADDRESS);
      assert.equal(bal2.toString(10), RAND_AMT);
      const bal3 = await simpleCoin.balanceOf(proxy.address);
      assert.equal(bal3.toString(10), '0');

      const res2 = await proxy.gatherErc20(simpleCoin.address);
      assertRes(res2);
    });

    it('should gather BAD ERC20 funds properly (no return bool)', async () => {
      const bal = await simpleBadCoin.balanceOf(proxy.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const res = await proxy.gatherErc20(simpleBadCoin.address);
      assertRes(res);
      console.log(
        `************************* Gas used gathering BAD ERC20: ${res.receipt.gasUsed}`,
      );

      const bal2 = await simpleBadCoin.balanceOf(COLD_ADDRESS);
      assert.equal(bal2.toString(10), RAND_AMT);
      const bal3 = await simpleBadCoin.balanceOf(proxy.address);
      assert.equal(bal3.toString(10), '0');

      const res2 = await proxy.gatherErc20(simpleBadCoin.address);
      assertRes(res2);
    });

    it('should gather ERC20 funds properly (killed)', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });
      const bal = await simpleCoin.balanceOf(proxy.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const res = await proxy.gatherErc20(simpleCoin.address);
      assertRes(res);

      const bal2 = await simpleCoin.balanceOf(ADMIN_ADDRESS);
      assert.equal(bal2.toString(10), RAND_AMT);
      const bal3 = await simpleCoin.balanceOf(proxy.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should gather ERC20 funds properly (non-proxy)', async () => {
      const bal = await simpleCoin.balanceOf(exchangeDepositor.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const res = await exchangeDepositor.gatherErc20(simpleCoin.address);
      assertRes(res);

      const bal2 = await simpleCoin.balanceOf(COLD_ADDRESS);
      assert.equal(bal2.toString(10), RAND_AMT);
      const bal3 = await simpleCoin.balanceOf(exchangeDepositor.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should gather ERC20 funds properly (non-proxy) (killed)', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });
      const bal = await simpleCoin.balanceOf(exchangeDepositor.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const res = await exchangeDepositor.gatherErc20(simpleCoin.address);
      assertRes(res);

      const bal2 = await simpleCoin.balanceOf(ADMIN_ADDRESS);
      assert.equal(bal2.toString(10), RAND_AMT);
      const bal3 = await simpleCoin.balanceOf(exchangeDepositor.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should gather ETH funds properly', async () => {
      const bal = await web3.eth.getBalance(proxy.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const beforeColdBal = BigInt(await web3.eth.getBalance(COLD_ADDRESS));
      const res = await proxy.gatherEth({ from });
      assertRes(res);
      console.log(
        `******************************* Gas used gathering ETH: ${res.receipt.gasUsed}`,
      );
      const afterColdBal = BigInt(await web3.eth.getBalance(COLD_ADDRESS));

      assert.equal((afterColdBal - beforeColdBal).toString(10), RAND_AMT);
      const bal3 = await web3.eth.getBalance(proxy.address);
      assert.equal(bal3.toString(10), '0');

      const res2 = await proxy.gatherEth({ from });
      assertRes(res2);
    });

    it('should gather ETH funds properly (killed)', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });
      const bal = await web3.eth.getBalance(proxy.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const beforeColdBal = BigInt(await web3.eth.getBalance(ADMIN_ADDRESS));
      const res = await proxy.gatherEth({ from });
      assertRes(res);
      const afterColdBal = BigInt(await web3.eth.getBalance(ADMIN_ADDRESS));

      assert.equal((afterColdBal - beforeColdBal).toString(10), RAND_AMT);
      const bal3 = await web3.eth.getBalance(proxy.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should gather ETH funds properly (non-proxy)', async () => {
      const bal = await web3.eth.getBalance(exchangeDepositor.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const beforeColdBal = BigInt(await web3.eth.getBalance(COLD_ADDRESS));
      const res = await exchangeDepositor.gatherEth({ from });
      assertRes(res);
      const afterColdBal = BigInt(await web3.eth.getBalance(COLD_ADDRESS));

      assert.equal((afterColdBal - beforeColdBal).toString(10), RAND_AMT);
      const bal3 = await web3.eth.getBalance(exchangeDepositor.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should gather ETH funds properly (non-proxy) (killed)', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });
      const bal = await web3.eth.getBalance(exchangeDepositor.address);
      assert.equal(bal.toString(10), RAND_AMT);

      const beforeColdBal = BigInt(await web3.eth.getBalance(ADMIN_ADDRESS));
      const res = await exchangeDepositor.gatherEth({ from });
      assertRes(res);
      const afterColdBal = BigInt(await web3.eth.getBalance(ADMIN_ADDRESS));

      assert.equal((afterColdBal - beforeColdBal).toString(10), RAND_AMT);
      const bal3 = await web3.eth.getBalance(exchangeDepositor.address);
      assert.equal(bal3.toString(10), '0');
    });

    it('should emit an event', async () => {
      const tx = await sendCoins(proxy.address, RAND_AMT, from);
      assertRes(tx);

      const results = await exchangeDepositor.getPastEvents('Deposit', {
        fromBlock: 0,
        toBlock: 'latest',
      });
      assert.equal(results.length, 1);

      const { receiver, amount } = results[0].returnValues;
      assert.equal(receiver, proxy.address);
      assert.equal(amount, RAND_AMT);
    });

    it('should fail to deposit value below mininput', async () => {
      const beforeBalanceMininput = BigInt(await web3.eth.getBalance(from));
      await expect(sendCoins(proxy.address, '9999999999999999', from))
        .to.be.revertedWithCustomError(
          ExchangeDepositFactoryEthers,
          'AmountTooSmall',
        )
        .withArgs('9999999999999999', '10000000000000000');
      const afterBalanceMininput = BigInt(await web3.eth.getBalance(from));
      console.log(
        `************************* Gas used for failed mininput: ${(
          (beforeBalanceMininput - afterBalanceMininput) /
          BigInt(await web3.eth.getGasPrice())
        ).toString(10)}`,
      );
    });
  });

  describe('Change attributes', async () => {
    it('should allow changing cold address', async () => {
      const res = await exchangeDepositor.changeColdAddress(COLD_ADDRESS2, {
        from: ADMIN_ADDRESS,
      });
      assertRes(res);
      assert.equal(await exchangeDepositor.coldAddress(), COLD_ADDRESS2);

      const coldBalance1 = BigInt(await web3.eth.getBalance(COLD_ADDRESS2));
      const tx = await sendCoins(proxy.address, RAND_AMT, from);
      assertRes(tx);
      const coldBalance2 = BigInt(await web3.eth.getBalance(COLD_ADDRESS2));
      assert.equal(coldBalance2 - coldBalance1, BigInt(RAND_AMT));
    });

    it('should fail changing cold address with wrong from address or 0x0 address param', async () => {
      await expectRevert(
        exchangeDepositor.changeColdAddress(COLD_ADDRESS2, { from }),
        `UnauthorizedCaller("${from}", "${ADMIN_ADDRESS}")`,
      );
      await expectRevert(
        exchangeDepositor.changeColdAddress(ZERO_ADDR, { from: ADMIN_ADDRESS }),
        `InvalidAddress("${ZERO_ADDR}")`,
      );
    });

    it('should allow changing implementation address', async () => {
      const res = await exchangeDepositor.changeImplAddress(
        sampleLogic.address,
        {
          from: ADMIN_ADDRESS,
        },
      );
      assertRes(res);
      assert.equal(
        await exchangeDepositor.implementation(),
        sampleLogic.address,
      );
    });

    it('should fail changing implementation address with wrong from address or non-contract address param', async () => {
      await expectRevert(
        exchangeDepositor.changeImplAddress(sampleLogic.address, {
          from: COLD_ADDRESS2,
        }),
        `UnauthorizedCaller("${COLD_ADDRESS2}", "${ADMIN_ADDRESS}")`,
      );
      await expectRevert(
        // Test Case 7 Fix for ImplementationNotContract
        exchangeDepositor.changeImplAddress(FUNDER_ADDRESS, {
          from: ADMIN_ADDRESS,
        }),
        `ImplementationNotAContract("${FUNDER_ADDRESS}")`,
      );
    });

    it('should allow changing minimumInput uint256', async () => {
      await expect(sendCoins(proxy.address, '1', from))
        .to.be.revertedWithCustomError(
          ExchangeDepositFactoryEthers,
          'AmountTooSmall',
        )
        .withArgs('1', '10000000000000000');
      const res = await exchangeDepositor.changeMinInput('1', {
        from: ADMIN_ADDRESS,
      });
      assertRes(res);
      assert.equal((await exchangeDepositor.minimumInput()).toString(10), '1');
      assert.ok(await sendCoins(proxy.address, '1', from));
    });

    it('should fail changing minimumInput uint256 with wrong from address', async () => {
      await expectRevert(
        exchangeDepositor.changeMinInput('1', { from }),
        `UnauthorizedCaller("${from}", "${ADMIN_ADDRESS}")`,
      );
    });
  });

  describe('Kill', async () => {
    it('should prevent sending after killed', async () => {
      const res = await exchangeDepositor.kill({
        from: ADMIN_ADDRESS,
      });
      assertRes(res);

      const beforeFromBalance = BigInt(await web3.eth.getBalance(from));
      await expect(
        sendCoins(proxy.address, '1000000000000', from),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'ContractIsDead',
      );
      const afterFromBalance = BigInt(await web3.eth.getBalance(from));

      const fees = beforeFromBalance - afterFromBalance;
      const gasPrice = BigInt(await web3.eth.getGasPrice());
      const gasUsed = fees / gasPrice;
      console.log(
        `********************************** Gas used in failure: ${gasUsed}`,
      );
    });

    it('should fail killing with wrong from address', async () => {
      await expectRevert(
        exchangeDepositor.kill({ from }),
        `UnauthorizedCaller("${from}", "${ADMIN_ADDRESS}")`,
      );
    });
  });

  describe('Extra Logic Upgrade', async () => {
    it('should allow for new logic to be added by changing implementation address', async () => {
      console.log(
        `DEBUG: Initial exchangeDepositor.implementation(): ${await exchangeDepositor.implementation()}`,
      );
      // const proxySampleLogic = await SampleLogic.at(proxy.address); // Truffle instance
      const ethersProxySampleLogic = new ethers.Contract(
        proxy.address,
        SampleLogic.abi,
        funderSigner,
      ); // Ethers instance
      await expect(ethersProxySampleLogic.gatherHalfErc20(simpleCoin.address)) // Using Ethers instance
        .to.be.revertedWithCustomError(
          ExchangeDepositFactoryEthers,
          'FallbackContractNotSet',
        );
      console.log('DEBUG: First expect (FallbackContractNotSet) passed.');

      assertRes(
        await exchangeDepositor.changeImplAddress(sampleLogic.address, {
          from: ADMIN_ADDRESS,
        }),
      );

      console.log(`DEBUG: sampleLogic.address: ${sampleLogic.address}`);
      console.log(
        `DEBUG: exchangeDepositor.implementation() after change: ${await exchangeDepositor.implementation()}`,
      );
      const proxyAsExchangeDeposit = await ExchangeDeposit.at(proxy.address);
      console.log(
        `DEBUG: proxy.implementation() (via main contract): ${await proxyAsExchangeDeposit.implementation()}`,
      );

      const halfErc20Tx = await ethersProxySampleLogic.gatherHalfErc20(
        simpleCoin.address,
      );
      const halfErc20Receipt = await halfErc20Tx.wait();
      assertRes(halfErc20Receipt); // Pass the receipt

      assert.equal(
        (await simpleCoin.balanceOf(proxy.address)).toString(10),
        (BigInt(RAND_AMT) - BigInt(RAND_AMT) / BigInt(2)).toString(10),
      );

      assertRes(await proxy.gatherErc20(simpleCoin.address));
      assert.equal(
        (await simpleCoin.balanceOf(proxy.address)).toString(10),
        '0',
      );

      assertRes(await simpleCoin.giveBalance(proxy.address, '84'));
      try {
        await ethersProxySampleLogic.gatherHalfErc20(simpleCoin.address);
        assert.fail(
          'Expected transaction to revert with FallbackContractFailed, but it did not revert.',
        );
      } catch (error) {
        expect(error.message).to.include('FallbackContractFailed()');
      }

      const exDepSampleLogic = await SampleLogic.at(exchangeDepositor.address);
      const salt = randSalt();
      const specialProxyAddress = await getContractAddr(
        exchangeDepositor.address,
        0,
        salt,
        true,
      );
      assertRes(await exDepSampleLogic.deploySpecialInstance(salt, { from }));
      const specialProxy = await ExchangeDeposit.at(specialProxyAddress);
      assert.equal(await getEmbeddedAddress(specialProxy.address), ZERO_ADDR);
    });
  });

  describe('Incorrect calls (with value etc.)', async () => {
    it('should not allow value to be added to non-payable methods', async () => {
      await assert.rejects(
        proxy.gatherErc20(simpleCoin.address, { value: '42' }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        proxy.gatherEth({ value: '42' }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        proxyFactory.deployNewInstance(randSalt(), { value: '42' }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        exchangeDepositor.changeColdAddress(COLD_ADDRESS2, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        exchangeDepositor.changeImplAddress(sampleLogic.address, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        exchangeDepositor.changeMinInput(RAND_AMT, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
      await assert.rejects(
        exchangeDepositor.kill({ value: '42', from: ADMIN_ADDRESS }),
        /Transaction reverted: non-payable function was called with value 42$/,
      );
    });
    it('should not allow calling change attribute methods from proxy', async () => {
      const signers = await ethers.getSigners();
      const adminSigner = signers[1]; // ADMIN_ADDRESS is accounts[1]
      const proxyEthersInstance = ExchangeDepositFactoryEthers.attach(
        proxy.address,
      );

      await expect(
        proxyEthersInstance
          .connect(adminSigner)
          .changeColdAddress(COLD_ADDRESS2),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'CallingWrongContract',
      );
      await expect(
        proxyEthersInstance
          .connect(adminSigner)
          .changeImplAddress(sampleLogic.address),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'CallingWrongContract',
      );
      await expect(
        proxyEthersInstance.connect(adminSigner).changeMinInput('1'),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'CallingWrongContract',
      );
      await expect(
        proxyEthersInstance.connect(adminSigner).kill(),
      ).to.be.revertedWithCustomError(
        ExchangeDepositFactoryEthers,
        'CallingWrongContract',
      );
    });
    it('should fail calling change attribute methods after killed', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });

      await expectRevert(
        exchangeDepositor.changeColdAddress(COLD_ADDRESS2, {
          from: ADMIN_ADDRESS,
        }),
        'ContractIsDead()',
      );
      await expectRevert(
        exchangeDepositor.changeImplAddress(sampleLogic.address, {
          from: ADMIN_ADDRESS,
        }),
        'ContractIsDead()',
      );
      await expectRevert(
        exchangeDepositor.changeMinInput('1', { from: ADMIN_ADDRESS }),
        'ContractIsDead()',
      );
      await expectRevert(
        exchangeDepositor.kill({ from: ADMIN_ADDRESS }),
        'ContractIsDead()',
      );
    });

    it('should revert ETH gathering if call fails', async () => {
      const res = await exchangeDepositor.changeColdAddress(
        sampleLogic.address,
        {
          from: ADMIN_ADDRESS,
        },
      );
      assertRes(res);
      await expectRevert(proxy.gatherEth({ from }), 'EthGatherFailed()');
    });

    it('should revert ERC20 gathering if call fails', async () => {
      await proxy.gatherErc20(simpleCoin.address);
      const res = await simpleCoin.giveBalance(proxy.address, '42');
      assertRes(res);
      await assert.rejects(
        proxy.gatherErc20(simpleCoin.address),
        /'SafeERC20: ERC20 operation did not succeed'$/,
      );
    });
  });
});

const sendCoins = async (to, value, from) => {
  return web3.eth.sendTransaction({
    from,
    to,
    value,
  });
};

let showCost = true;
const deploy = async (arg1, arg2, presend) => {
  const accounts = await web3.eth.getAccounts();
  const from = accounts[9];
  const simpleCoin = await SimpleCoin.new({ from });
  const simpleBadCoin = await SimpleBadCoin.new({ from });
  const sampleLogic = await SampleLogic.new({ from });

  if (presend !== undefined) {
    const addr = await getContractAddr(from, 3);
    await sendCoins(addr, presend, from);
    await simpleCoin.giveBalance(addr, presend, { from });
    await simpleBadCoin.giveBalance(addr, presend, { from });
  }
  const beforeFromBalance = BigInt(await web3.eth.getBalance(from));
  const exchangeDepositor = await ExchangeDeposit.new(arg1, arg2, { from });
  const afterFromBalance = BigInt(await web3.eth.getBalance(from));

  const fees = beforeFromBalance - afterFromBalance;
  const gasPrice = BigInt(await web3.eth.getGasPrice());
  const gasUsed = fees / gasPrice;
  if (showCost) {
    console.log(
      `***************************** Gas used for main deploy: ${gasUsed}`,
    );
    showCost = false;
  }

  const proxyFactory = await ProxyFactory.new(exchangeDepositor.address, {
    from,
  });
  const salt = randSalt();
  const testCalc = await getContractAddr(
    proxyFactory.address,
    0,
    salt,
    false,
    exchangeDepositor.address,
  );
  const proxyAddress = await proxyFactory.deployNewInstance.call(salt);
  assert.equal(testCalc, proxyAddress);
  console.log(
    `DEBUG: In deploy, before pre-sending to proxy. exchangeDepositor addr: ${exchangeDepositor.address}`,
  );
  try {
    const currentColdAddress = await exchangeDepositor.coldAddress();
    console.log(
      `DEBUG: In deploy, exchangeDepositor.coldAddress(): ${currentColdAddress}`,
    );
    const currentImplAddress = await exchangeDepositor.implementation();
    console.log(
      `DEBUG: In deploy, exchangeDepositor.implementation(): ${currentImplAddress}`,
    );
    console.log(`DEBUG: In deploy, proxy computed address: ${proxyAddress}`);
  } catch (e) {
    console.log(
      `DEBUG: In deploy, error getting exchangeDepositor details: ${e.message}`,
    );
  }
  if (presend !== undefined) {
    await sendCoins(proxyAddress, presend, from);
    await simpleCoin.giveBalance(proxyAddress, presend, { from });
    await simpleBadCoin.giveBalance(proxyAddress, presend, { from });
  }
  const tx = await proxyFactory.deployNewInstance(salt, { from });
  assertRes(tx);
  const proxy = await ExchangeDeposit.at(proxyAddress);
  return {
    exchangeDepositor,
    proxy,
    proxyFactory,
    sampleLogic,
    simpleCoin,
    simpleBadCoin,
  };
};

const getContractAddr = async (
  sender,
  offset = 0,
  salt = null,
  tweak = false,
  contractAddr = sender,
) => {
  if (salt === null) {
    const nonce = await web3.eth.getTransactionCount(sender);
    const data = rlp.encode([sender, nonce + offset]);
    return web3.utils.toChecksumAddress(web3.utils.keccak256(data).slice(-40));
  } else {
    if (!salt.match(/^0x[0-9a-fA-F]{64}$/)) throw new Error('wrong salt');
    const addr = sender.replace(/^0x/, '').toLowerCase();
    const addrCont = contractAddr.replace(/^0x/, '').toLowerCase();
    const contractData = Buffer.from(deployCode(addrCont, '', tweak), 'hex');
    const data = Buffer.concat([
      Buffer.from([0xff]),
      Buffer.from(addr, 'hex'),
      Buffer.from(salt.replace(/^0x/, '').toLowerCase(), 'hex'),
      Buffer.from(web3.utils.keccak256(contractData).replace(/^0x/, ''), 'hex'),
    ]);
    return web3.utils.toChecksumAddress(
      '0x' + web3.utils.keccak256(data).slice(-40),
    );
  }
};

const getEmbeddedAddress = async (proxyAddress) => {
  const code = await web3.eth.getCode(proxyAddress);
  const expected = runtimeCode(ZERO_ADDR.replace(/^0x/, ''));
  if (
    code.slice(2, 4) !== expected.slice(2, 4) ||
    code.slice(44) !== expected.slice(44)
  ) {
    return ZERO_ADDR;
  } else {
    return web3.utils.toChecksumAddress(`0x${code.slice(4, 44)}`);
  }
};

const assertRes = (res) => {
  assert.equal(((res || {}).receipt || res || {}).status, true);
};

const randSalt = () => '0x' + crypto.randomBytes(32).toString('hex');

const randNumberString = (min, max) => {
  const minBigInt = BigInt(min);
  const diff = BigInt(max) - minBigInt;
  const randInt1 = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const randInt2 = Math.floor(Math.random() * 1000);
  const randAdd = (BigInt(randInt1) * BigInt(randInt2)) % diff;
  return (randAdd + minBigInt).toString(10);
};
