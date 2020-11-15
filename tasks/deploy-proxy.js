const crypto = require('crypto');

task('deploy-proxy', 'Deploys a proxy from ProxyFactory')
  .addParam('factory', 'The factory address')
  .addOptionalParam('salt', 'The salt for generating the proxy', randomSalt())
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
