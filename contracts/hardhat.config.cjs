// Compiles with the solc package from npm (pinned in package.json) instead of a downloaded compiler, so the
// build is the same everywhere and needs no access to binaries.soliditylang.org.
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const {subtask} = require('hardhat/config');
const {TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD} = require('hardhat/builtin-tasks/task-names');

const VERSION = '0.8.28';
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({solcVersion}, hre, runSuper) => {
  if (solcVersion !== VERSION) return runSuper();
  const path = require.resolve('solc/soljson.js');
  return {compilerPath: path, isSolcJs: true, version: VERSION, longVersion: require('solc/package.json').version};
});

module.exports = {
  solidity: {version: VERSION, settings: {optimizer: {enabled: true, runs: 200}, evmVersion: 'cancun'}}
};
