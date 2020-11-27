const fs = require('fs');
const path = require('path');
const solc = require('solc');

function verifyContract(contractName) {
  try {
    const contractData = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', `${contractName}.sol`),
      'utf8',
    );
    const settings = {
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
    };
    const solcFileName = path.join('contracts', `${contractName}.sol`);
    const solcInputString = JSON.stringify({
      language: 'Solidity',
      sources: {
        [solcFileName]: {
          content: contractData,
        },
      },
      settings,
    });
    function findImportsArg(importFileName) {
      let data;
      try {
        data = fs.readFileSync(
          path.join(__dirname, '..', 'node_modules', importFileName),
          'utf8',
        );
      } catch (e) {}
      if (data) {
        return { contents: data };
      } else {
        return { error: 'Import file not found: ' + importFileName };
      }
    }
    const output = solc.compile(solcInputString, { import: findImportsArg });
    const outputJson = JSON.parse(output);
    const solcBytecode =
      outputJson.contracts[solcFileName][contractName].evm.bytecode.object;

    const hardhatString = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        'artifacts',
        'contracts',
        `${contractName}.sol`,
        `${contractName}.json`,
      ),
      'utf8',
    );
    const hardhatData = JSON.parse(hardhatString);
    const hhBytecode = hardhatData.bytecode.replace(/^0x/, '');

    if (solcBytecode !== hhBytecode) {
      console.error('*******************************');
      console.error('*******************************');
      console.error('*******************************');
      console.error(
        'WARNING: Using hardhat gave different bytes than solc directly!!!',
      );
      console.error('*******************************');
      console.error('*******************************');
      console.error('*******************************');
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      'WARNING: Was not able to verify the bytecode matches direct solidity.',
    );
    return false;
  }
}

module.exports = verifyContract;

if (require.main === module) {
  if (verifyContract(process.argv[2])) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}
