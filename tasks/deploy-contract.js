const verifyContract = require('../bin/verifyContract');

task('deploy', 'Deploys a contract with given arguments')
  .addParam('contract', 'The name of the contract')
  .addParam(
    'arguments',
    'The constructor arguments for the contract (ie. \'["arg1","arg2"]\')',
  )
  .setAction(async (taskArgs, hre) => {
    await hre.run('compile');

    // Verifying hardhat matches solc
    verifyContract(taskArgs.contract);

    const Contract = await hre.ethers.getContractFactory(taskArgs.contract);

    const gasPrice = await hre.web3.eth.getGasPrice();
    const accounts = await hre.web3.eth.getAccounts();
    const balance = await hre.web3.eth.getBalance(accounts[0]);

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
    const contract = await Contract.deploy(...JSON.parse(taskArgs.arguments));
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
