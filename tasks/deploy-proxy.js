const crypto = require('crypto');

// For prompting user
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});
const prompt = query => new Promise(resolve => rl.question(query, resolve));

task('deploy-proxy', 'Deploys a proxy from ProxyFactory')
  .addParam('factory', 'The factory address')
  .addOptionalParam('salt', 'The salt for generating the proxy', randomSalt())
  .addOptionalParam(
    'skipPrompt',
    'Skip the contract address check prompt',
    'false',
  )
  .setAction(async (taskArgs, hre) => {
    await hre.run('compile');
    console.log('=======================');
    console.log('Starting deployment of Proxy');
    console.log('=======================');
    const proxyFactory = await hre.ethers.getContractAt(
      'ProxyFactory',
      taskArgs.factory,
    );
    const proxyAddress = await proxyFactory.callStatic.deployNewInstance(
      taskArgs.salt,
    );

    if (taskArgs.skipPrompt === 'false') {
      console.log('=======================');
      console.log(`                Salt: ${taskArgs.salt}`);
      console.log(`Result Proxy Address: ${proxyAddress}`);
      console.log('=======================');
      const answer = await prompt('Is this OK? (y/n) ');
      if (answer !== 'y') {
        throw new Error('Did not answer "y" on confirmation prompt! Aborting!');
      }
    }

    // Get start time of deploy
    const startTime = Date.now();
    const tx = await proxyFactory.deployNewInstance(taskArgs.salt);
    // Show time every 5 seconds
    const cancelToken = setInterval(() => {
      const currentTime = Date.now();
      console.log(
        `Waiting confirmation for ${Math.floor(
          (currentTime - startTime) / 1000,
        )} seconds`,
      );
    }, 5000);
    // Wait for the tx to confirm
    await tx.wait();
    // Stop the repeat timer
    clearInterval(cancelToken);
    console.log('=======================');
    console.log(`Proxy deployed to ${proxyAddress}`);
    console.log('=======================');
  });

function randomSalt() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}
