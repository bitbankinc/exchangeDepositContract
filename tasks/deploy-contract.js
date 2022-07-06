const rlp = require('rlp');
const verifyContract = require('../bin/verifyContract');

// For prompting user
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});
const prompt = query => new Promise(resolve => rl.question(query, resolve));

task('deploy', 'Deploys a contract with given arguments')
  .addParam('contract', 'The name of the contract')
  .addParam(
    'arguments',
    'The constructor arguments for the contract (ie. \'["arg1","arg2"]\')',
  )
  .addOptionalParam(
    'skipPrompt',
    'Skip the contract address check prompt',
    'false',
  )
  .setAction(async (taskArgs, hre) => {
    await hre.run('compile');

    // Verifying hardhat matches solc
    verifyContract(taskArgs.contract);

    const Contract = await hre.ethers.getContractFactory(taskArgs.contract);
    const args = JSON.parse(taskArgs.arguments);

    const gasPrice = await hre.web3.eth.getGasPrice();
    const accounts = await hre.web3.eth.getAccounts();
    const balance = await hre.web3.eth.getBalance(accounts[0]);

    if (taskArgs.skipPrompt === 'false') {
      const { address, nonce } = await getContractAddress(
        accounts[0],
        hre.web3,
      );
      console.log('=======================');
      if (taskArgs.contract === 'ExchangeDeposit') {
        console.log('== Contract Constructor Arguments ==');
        console.log(`1.            Cold Address: ${args[0]}`);
        console.log(`2.           Admin Address: ${args[1]}`);
        console.log('=======================');
      } else if (taskArgs.contract === 'ProxyFactory') {
        console.log('== Contract Constructor Arguments ==');
        console.log(`1. ExchangeDeposit Address: ${args[0]}`);
        console.log('=======================');
      }
      console.log(`            Deploy Account: ${accounts[0]}`);
      console.log(`      Deploy Account nonce: ${nonce}`);
      console.log(`   Result Contract Address: ${address}`);
      console.log('=======================');
      const answer = await prompt('Is this OK? (y/n) ');
      if (answer !== 'y') {
        throw new Error('Did not answer "y" on confirmation prompt! Aborting!');
      }
    }

    console.log('=======================');
    console.log(
      `Starting deployment of ${taskArgs.contract} with ` +
        `arguments ${taskArgs.arguments} at gas price ${gasPrice} ` +
        `with balance of ${balance}`,
    );
    console.log('=======================');
    // Get start time of deploy
    const startTime = Date.now();
    // Deploy
    const contract = await Contract.deploy(...args);
    // Show time every 5 seconds
    const cancelToken = setInterval(() => {
      const currentTime = Date.now();
      console.log(
        `Waiting confirmation for ${Math.floor(
          (currentTime - startTime) / 1000,
        )} seconds`,
      );
    }, 5000);
    // Wait for contract deploy
    await contract.deployed();
    // Stop the repeat timer
    clearInterval(cancelToken);
    // Log results
    console.log('=======================');
    console.log(
      `${taskArgs.contract} was deployed at ${contract.address} with ` +
        `arguments ${taskArgs.arguments}`,
    );
    console.log('=======================');
  });

async function getContractAddress(sender, web3) {
  const nonce = await web3.eth.getTransactionCount(sender);
  const data = rlp.encode([sender, nonce]);
  const address = web3.utils.toChecksumAddress(
    web3.utils.keccak256(data).slice(-40),
  );
  return {
    nonce,
    address,
  };
}
