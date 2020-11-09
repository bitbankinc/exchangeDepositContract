const assert = require('assert');
const crypto = require('crypto');
const rlp = require('rlp');
const SampleLogic = artifacts.require('SampleLogic');
const ExchangeDeposit = artifacts.require('ExchangeDeposit');
const SimpleCoin = artifacts.require('SimpleCoin');
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Don't report gas if running coverage
// solidity-coverage gas costs are irregular
let DEPOSIT_GAS_MAX = 42000;
if (process.env.npm_lifecycle_script === 'truffle run coverage') {
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

contract('ExchangeDeposit', async accounts => {
  const COLD_ADDRESS = accounts[0];
  const ADMIN_ADDRESS = accounts[1];
  const COLD_ADDRESS2 = accounts[7];
  const ADMIN_ADDRESS2 = accounts[8];
  const FUNDER_ADDRESS = accounts[9];
  const from = FUNDER_ADDRESS;
  let exchangeDepositor, proxy, sampleLogic, simpleCoin, RAND_AMT;

  // Deploy a fresh batch of contracts for each test
  beforeEach(async () => {
    // Random amount string between 0.01 ETH and 0.5 ETH (in wei)
    RAND_AMT = randNumberString('10000000000000000', '500000000000000000');
    const deployed = await deploy(COLD_ADDRESS, ADMIN_ADDRESS, RAND_AMT);
    ({ exchangeDepositor, proxy, sampleLogic, simpleCoin } = deployed);
  });

  describe('Deploy and Attributes', async () => {
    it('should deploy', async () => {
      assert.equal(
        await proxy.exchangeDepositorAddress(),
        exchangeDepositor.address,
      );
    });

    it('should fail deploy if using 0x0 address for constructor', async () => {
      await assert.rejects(
        ExchangeDeposit.new(exchangeDepositor.address, ZERO_ADDR, { from }),
        /0x0 is an invalid address\.$/,
      );
      await assert.rejects(
        ExchangeDeposit.new(ZERO_ADDR, exchangeDepositor.address, { from }),
        /0x0 is an invalid address\.$/,
      );
    });

    it('should set attributes properly', async () => {
      assert.equal(await exchangeDepositor.coldAddress(), COLD_ADDRESS);
      assert.equal(
        await exchangeDepositor.exchangeDepositorAddress(),
        ZERO_ADDR,
      );
      assert.equal(await exchangeDepositor.adminAddress(), ADMIN_ADDRESS);
      assert.equal(await exchangeDepositor.implementation(), ZERO_ADDR);
      assert.equal(await proxy.coldAddress(), ZERO_ADDR);
      assert.equal(
        await proxy.exchangeDepositorAddress(),
        exchangeDepositor.address,
      );
      // immutable references pull directly from logic code
      // so it will always be the same
      assert.equal(await proxy.adminAddress(), ADMIN_ADDRESS);
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
      assert.ok(await exchangeDepositor.deployNewInstance(salt, { from }));
      await assert.rejects(
        exchangeDepositor.deployNewInstance(salt, { from }),
        /revert$/,
      );
    });
  });

  describe('Gas costs', async () => {
    it('should have reasonable proxy deploy gas', async () => {
      const tx = await exchangeDepositor.deployNewInstance(randSalt(), {
        from,
      });
      assertRes(tx);
      console.log(
        `**********************  Proxy contract deploy gas used: ${tx.receipt.gasUsed}`,
      );
      assert.ok(tx.receipt.gasUsed <= 85000, 'Deploy gas too expensive');
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
      assert.equal(fromBalance1 - fromBalance2, BigInt(RAND_AMT) + fee); // deposit amount + fee
    });

    it('should fail if the cold address reverts', async () => {
      const res = await exchangeDepositor.changeColdAddress(
        sampleLogic.address,
        {
          from: ADMIN_ADDRESS,
        },
      );
      assertRes(res);
      await assert.rejects(
        sendCoins(proxy.address, RAND_AMT, from),
        /Forwarding funds failed$/,
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

      // Should not throw if balance is 0
      const res2 = await proxy.gatherErc20(simpleCoin.address);
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

      // Should not throw if balance is 0
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
      await assert.rejects(
        sendCoins(proxy.address, '9999999999999999', from),
        /Amount too small$/,
      );
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

      // Check to make sure the funds were forwarded to the new address
      const coldBalance1 = BigInt(await web3.eth.getBalance(COLD_ADDRESS2));
      const tx = await sendCoins(proxy.address, RAND_AMT, from);
      assertRes(tx);
      const coldBalance2 = BigInt(await web3.eth.getBalance(COLD_ADDRESS2));
      assert.equal(coldBalance2 - coldBalance1, BigInt(RAND_AMT)); // deposit amount
    });

    it('should fail changing cold address with wrong from address or 0x0 address param', async () => {
      // non-cold can not change
      await assert.rejects(
        exchangeDepositor.changeColdAddress(
          COLD_ADDRESS2,
          { from }, // this would succeed with exchangeDepositor.coldAddress
        ),
        /Unauthorized caller\.$/,
      );

      // Can not change to 0x0 address
      await assert.rejects(
        exchangeDepositor.changeColdAddress(ZERO_ADDR, { from: ADMIN_ADDRESS }),
        /0x0 is an invalid address\.$/,
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
      // Check for the efficacy of this change is done separately
    });

    it('should fail changing implementation address with wrong from address or non-contract address param', async () => {
      // non-cold can not change
      await assert.rejects(
        exchangeDepositor.changeImplAddress(
          sampleLogic.address,
          { from: COLD_ADDRESS2 }, // this would succeed with exchangeDepositor.coldAddress
        ),
        /Unauthorized caller\.$/,
      );

      // Can not change to non-contract address
      await assert.rejects(
        exchangeDepositor.changeImplAddress(FUNDER_ADDRESS, {
          from: ADMIN_ADDRESS,
        }),
        /implementation must be contract\.$/,
      );
    });

    it('should allow changing minimumInput uint256', async () => {
      await assert.rejects(
        sendCoins(proxy.address, '1', from),
        /Amount too small$/,
      );
      const res = await exchangeDepositor.changeMinInput('1', {
        from: ADMIN_ADDRESS,
      });
      assertRes(res);
      assert.equal((await exchangeDepositor.minimumInput()).toString(10), '1');
      assert.ok(await sendCoins(proxy.address, '1', from));
    });

    it('should fail changing minimumInput uint256 with wrong from address', async () => {
      await assert.rejects(
        exchangeDepositor.changeMinInput('1', {
          from,
        }),
        /Unauthorized caller\.$/,
      );
    });
  });

  describe('Kill', async () => {
    it('should prevent sending after killed', async () => {
      // kill
      const res = await exchangeDepositor.kill({
        from: ADMIN_ADDRESS,
      });
      assertRes(res);

      // send should reject
      const beforeFromBalance = BigInt(await web3.eth.getBalance(from));
      await assert.rejects(
        sendCoins(proxy.address, '1000000000000', from),
        /revert I am dead :-\($/,
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
      await assert.rejects(
        exchangeDepositor.kill({
          from,
        }),
        /Unauthorized caller\.$/,
      );
    });
  });

  describe('Extra Logic Upgrade', async () => {
    it('should allow for new logic to be added by changing implementation address', async () => {
      // This simple logic will fail unless we change the implementation
      const proxySampleLogic = await SampleLogic.at(proxy.address);
      await assert.rejects(
        proxySampleLogic.gatherHalfErc20(simpleCoin.address),
        /Fallback contract not set\.$/,
      );
      // change implementation to the sampleLogic instance address
      assertRes(
        await exchangeDepositor.changeImplAddress(sampleLogic.address, {
          from: ADMIN_ADDRESS,
        }),
      );

      // Should now work
      assertRes(await proxySampleLogic.gatherHalfErc20(simpleCoin.address));
      assert.equal(
        (await simpleCoin.balanceOf(proxy.address)).toString(10),
        (BigInt(RAND_AMT) - BigInt(RAND_AMT) / BigInt(2)).toString(10),
      );

      // gather the rest
      assertRes(await proxy.gatherErc20(simpleCoin.address));
      assert.equal(
        (await simpleCoin.balanceOf(proxy.address)).toString(10),
        '0',
      );

      // Give 84 (half is 42 which will fail due to our ERC20 contract's logic)
      assertRes(await simpleCoin.giveBalance(proxy.address, '84'));
      await assert.rejects(
        proxySampleLogic.gatherHalfErc20(simpleCoin.address),
        /Fallback contract failed\.$/,
      );

      // Check if exchangeDepositorAddress is 0x0 when code is correct length
      // but the actual code doesn't match
      const exDepSampleLogic = await SampleLogic.at(exchangeDepositor.address);
      const salt = randSalt();
      const specialProxyAddress = await getContractAddr(
        exchangeDepositor.address,
        0,
        salt,
        true,
      );
      // ExchangeDepositor uses SampleLogic via DELEGATECALL to generate a proxy
      // with a different byte code (but same EVM result)
      assertRes(await exDepSampleLogic.deploySpecialInstance(salt, { from }));
      // Usually a proxy would return the ExchangeDeposit address, but since this
      // one doesn't match the bytecode perfectly it returns 0x0 address just like
      // ExchangeDeposit would do.
      const specialProxy = await ExchangeDeposit.at(specialProxyAddress);
      assert.equal(await specialProxy.exchangeDepositorAddress(), ZERO_ADDR);
    });
  });

  describe('Incorrect calls (with value etc.)', async () => {
    it('should not allow value to be added to non-payable methods', async () => {
      await assert.rejects(
        proxy.gatherErc20(simpleCoin.address, { value: '42' }),
        /revert$/,
      );
      await assert.rejects(proxy.gatherEth({ value: '42' }), /revert$/);
      await assert.rejects(
        exchangeDepositor.deployNewInstance(randSalt(), { value: '42' }),
        /revert$/,
      );
      await assert.rejects(
        exchangeDepositor.changeColdAddress(COLD_ADDRESS2, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /revert$/,
      );
      await assert.rejects(
        exchangeDepositor.changeImplAddress(sampleLogic.address, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /revert$/,
      );
      await assert.rejects(
        exchangeDepositor.changeMinInput(RAND_AMT, {
          value: '42',
          from: ADMIN_ADDRESS,
        }),
        /revert$/,
      );
      await assert.rejects(
        exchangeDepositor.kill({ value: '42', from: ADMIN_ADDRESS }),
        /revert$/,
      );
    });
    it('should not allow calling change attribute methods from proxy', async () => {
      await assert.rejects(
        proxy.changeColdAddress(COLD_ADDRESS2, { from: ADMIN_ADDRESS }),
        /Calling Wrong Contract\.$/,
      );
      await assert.rejects(
        proxy.changeImplAddress(sampleLogic.address, { from: ADMIN_ADDRESS }),
        /Calling Wrong Contract\.$/,
      );
      await assert.rejects(
        proxy.changeMinInput('1', { from: ADMIN_ADDRESS }),
        /Calling Wrong Contract\.$/,
      );
      await assert.rejects(
        proxy.kill({ from: ADMIN_ADDRESS }),
        /Calling Wrong Contract\.$/,
      );
    });
    it('should fail calling change attribute methods after killed', async () => {
      await exchangeDepositor.kill({ from: ADMIN_ADDRESS });

      await assert.rejects(
        exchangeDepositor.changeColdAddress(COLD_ADDRESS2, {
          from: ADMIN_ADDRESS,
        }),
        /I am dead :-\(\.$/,
      );
      await assert.rejects(
        exchangeDepositor.changeImplAddress(sampleLogic.address, {
          from: ADMIN_ADDRESS,
        }),
        /I am dead :-\(\.$/,
      );
      await assert.rejects(
        exchangeDepositor.changeMinInput('1', { from: ADMIN_ADDRESS }),
        /I am dead :-\(\.$/,
      );
      await assert.rejects(
        exchangeDepositor.kill({ from: ADMIN_ADDRESS }),
        /I am dead :-\(\.$/,
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
      await assert.rejects(
        proxy.gatherEth({ from }),
        /Could not gather ETH\.$/,
      );
    });

    it('should revert ERC20 gathering if call fails', async () => {
      await proxy.gatherErc20(simpleCoin.address);
      const res = await simpleCoin.giveBalance(proxy.address, '42');
      assertRes(res);
      await assert.rejects(
        proxy.gatherErc20(simpleCoin.address),
        /Could not gather ERC20\.$/,
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
  // Use money from the 10th account
  const from = accounts[9];
  const simpleCoin = await SimpleCoin.new({ from });
  const sampleLogic = await SampleLogic.new({ from });

  if (presend !== undefined) {
    const addr = await getContractAddr(from, 2);
    await sendCoins(addr, presend, from);
    await simpleCoin.giveBalance(addr, presend, { from });
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

  const salt = randSalt();
  const testCalc = await getContractAddr(exchangeDepositor.address, 0, salt);
  const proxyAddress = await exchangeDepositor.deployNewInstance.call(salt);
  // assert.equal(testCalc, proxyAddress);
  if (presend !== undefined) {
    await sendCoins(proxyAddress, presend, from);
    await simpleCoin.giveBalance(proxyAddress, presend, { from });
  }
  const tx = await exchangeDepositor.deployNewInstance(salt, { from });
  assertRes(tx);
  const proxy = await ExchangeDeposit.at(proxyAddress);
  return {
    exchangeDepositor,
    proxy,
    sampleLogic,
    simpleCoin,
  };
};

const getContractAddr = async (
  sender,
  offset = 0,
  salt = null,
  tweak = false,
) => {
  if (salt === null) {
    const nonce = await web3.eth.getTransactionCount(sender);
    const data = rlp.encode([sender, nonce + offset]);
    return web3.utils.toChecksumAddress(web3.utils.keccak256(data).slice(-40));
  } else {
    if (!salt.match(/^0x[0-9a-fA-F]{64}$/)) throw new Error('wrong salt');
    const addr = sender.replace(/^0x/, '').toLowerCase();
    const contractData = Buffer.from(deployCode(addr, '', tweak), 'hex');
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

const assertRes = res => {
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
