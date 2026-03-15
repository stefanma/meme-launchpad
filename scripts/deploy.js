/**
 * MEME Launchpad 部署脚本
 *
 * 部署顺序：
 * 1. MEMEFactory
 * 2. MEMEHelper
 * 3. MEMECore (实现 + ERC1967 代理) + initialize
 * 4. Factory.setMetaNode(Core 代理)
 * 5. Helper.grantRole(CORE_ROLE, Core 代理)
 * 6. MEMEVesting (实现 + ERC1967 代理) + initialize
 * 7. Core.setVesting(Vesting 代理)
 *
 * MetaNodeToken 由 Factory 在业务中按需 CREATE2 部署，不在此脚本中部署。
 *
 * 使用方式：
 *   npx hardhat run scripts/deploy.js --network <network>
 * 环境变量（可选）：
 *   PANCAKE_V2_ROUTER  WBNB  RPC_URL  PRIVATE_KEY
 *   SIGNER  PLATFORM_FEE_RECEIVER  MARGIN_RECEIVER  GRADUATE_FEE_RECEIVER
 */

import { createRequire } from "module";
import { network } from "hardhat";

const require = createRequire(import.meta.url);

// 链上 DEX 地址（可按网络覆盖）
const CHAIN_CONFIG = {
  bsc: {
    pancakeV2Router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  },
  bscTestnet: {
    pancakeV2Router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
    wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  },
  hardhat: {
    pancakeV2Router: "0x0000000000000000000000000000000000000001",
    wbnb: "0x0000000000000000000000000000000000000002",
  },
};

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const config = {
    admin: process.env.ADMIN_ADDRESS || deployer.address,
    signer: process.env.SIGNER_ADDRESS || deployer.address,
    platformFeeReceiver:
      process.env.PLATFORM_FEE_RECEIVER || deployer.address,
    marginReceiver: process.env.MARGIN_RECEIVER || deployer.address,
    graduateFeeReceiver:
      process.env.GRADUATE_FEE_RECEIVER || deployer.address,
    router:
      process.env.PANCAKE_V2_ROUTER ||
      CHAIN_CONFIG[process.env.HARDHAT_NETWORK || "hardhat"]?.pancakeV2Router ||
      CHAIN_CONFIG.hardhat.pancakeV2Router,
    wbnb:
      process.env.WBNB_ADDRESS ||
      CHAIN_CONFIG[process.env.HARDHAT_NETWORK || "hardhat"]?.wbnb ||
      CHAIN_CONFIG.hardhat.wbnb,
  };

  console.log("Deploying with account:", deployer.address);
  console.log("Config:", config);

  // 1. MEMEFactory
  const MEMEFactory = await ethers.getContractFactory("MEMEFactory");
  const factory = await MEMEFactory.deploy(config.admin);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("MEMEFactory deployed:", factoryAddress);

  // 2. MEMEHelper
  const MEMEHelper = await ethers.getContractFactory("MEMEHelper");
  const helper = await MEMEHelper.deploy(
    config.admin,
    config.router,
    config.wbnb
  );
  await helper.waitForDeployment();
  const helperAddress = await helper.getAddress();
  console.log("MEMEHelper deployed:", helperAddress);

  // 3. MEMECore 实现 + 代理
  const MetaNodeCore = await ethers.getContractFactory("MetaNodeCore");
  const coreImpl = await MetaNodeCore.deploy();
  await coreImpl.waitForDeployment();
  const coreImplAddress = await coreImpl.getAddress();
  console.log("MetaNodeCore implementation deployed:", coreImplAddress);

  const initData = MetaNodeCore.interface.encodeFunctionData("initialize", [
    factoryAddress,
    helperAddress,
    config.signer,
    config.platformFeeReceiver,
    config.marginReceiver,
    config.graduateFeeReceiver,
    config.admin,
  ]);

  const ERC1967ProxyArtifact = require("@openzeppelin/contracts/build/contracts/ERC1967Proxy.json");
  const ProxyFactory = new ethers.ContractFactory(
    ERC1967ProxyArtifact.abi,
    ERC1967ProxyArtifact.bytecode,
    deployer
  );
  const coreProxy = await ProxyFactory.deploy(coreImplAddress, initData);
  await coreProxy.waitForDeployment();
  const coreProxyAddress = await coreProxy.getAddress();
  console.log("MetaNodeCore proxy deployed:", coreProxyAddress);

  const core = MetaNodeCore.attach(coreProxyAddress);

  // 4. Factory.setMetaNode(Core 代理)
  const setMetaNodeTx = await factory.setMetaNode(coreProxyAddress);
  await setMetaNodeTx.wait();
  console.log("Factory.setMetaNode(core) done");

  // 5. Helper.grantRole(CORE_ROLE, Core 代理)
  const CORE_ROLE = await helper.CORE_ROLE();
  const grantTx = await helper.grantRole(CORE_ROLE, coreProxyAddress);
  await grantTx.wait();
  console.log("Helper.grantRole(CORE_ROLE, core) done");

  // 6. MEMEVesting 实现 + 代理
  const MEMEVesting = await ethers.getContractFactory("MEMEVesting");
  const vestingImpl = await MEMEVesting.deploy();
  await vestingImpl.waitForDeployment();
  const vestingImplAddress = await vestingImpl.getAddress();
  console.log("MEMEVesting implementation deployed:", vestingImplAddress);

  const vestingInitData = MEMEVesting.interface.encodeFunctionData(
    "initialize",
    [config.admin, coreProxyAddress]
  );
  const vestingProxy = await ProxyFactory.deploy(
    vestingImplAddress,
    vestingInitData
  );
  await vestingProxy.waitForDeployment();
  const vestingProxyAddress = await vestingProxy.getAddress();
  console.log("MEMEVesting proxy deployed:", vestingProxyAddress);

  // 7. Core.setVesting(Vesting 代理)
  const setVestingTx = await core.setVesting(vestingProxyAddress);
  await setVestingTx.wait();
  console.log("Core.setVesting(vesting) done");

  const out = {
    network: process.env.HARDHAT_NETWORK || "hardhat",
    MEMEFactory: factoryAddress,
    MEMEHelper: helperAddress,
    MetaNodeCore_implementation: coreImplAddress,
    MetaNodeCore_proxy: coreProxyAddress,
    MEMEVesting_implementation: vestingImplAddress,
    MEMEVesting_proxy: vestingProxyAddress,
  };
  console.log("\n========== Deployed addresses ==========");
  console.log(JSON.stringify(out, null, 2));
  return out;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
