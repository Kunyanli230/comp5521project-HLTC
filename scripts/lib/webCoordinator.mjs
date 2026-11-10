// The HTTP coordination layer of Task B: Reuse module B, read the chain, prepare the transaction, and verify the result. Do not create a Wallet, do not access the private key of the account, do not sign or broadcast transactions, nor save Alice's secrets.
import { Contract, FetchRequest, JsonRpcProvider, ZeroAddress, getAddress,
  isHexString, keccak256, parseUnits, parseEther } from "ethers";
import { createRequire } from "node:module";
import runtime from "./runtime.js";
import protocol from "./protocol.js";
import recovery from "./recovery.js";
import { DEFAULT_POLICY, validatePublicSetup, requireBytes32, expectedLock,
  assertFields, safeErrorMessage } from "../../shared/swapInputs.mjs";
import { assessTimelocks, assertTimeWindows, workflowState,
  planEthLock, planEthClaim, planRainClaim } from "./webProtocol.mjs";

const require = createRequire(import.meta.url);
const networks = require("../../config/networks.js");
const tokenAbi = ["function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)"];
const swapFields = ["sender", "receiver", "token", "amount", "hashlock", "timelock", "status"];

function plainSwap(swap) {
  return Object.fromEntries(swapFields.map((key) => [key, swap[key]]));
}

//Dependencies are injectable, facilitating local verification. The formal service only uses the RPC of the repository deployment record and server configuration.
export function createCoordinator(chains, tokenAddress, policy = DEFAULT_POLICY, deploymentIssues = [], deploymentWarnings = []) {
  const token = new Contract(tokenAddress, tokenAbi, chains.rain.provider);

  async function checkNetworks() {
    await Promise.all(Object.values(chains).map(runtime.assertChain));
  }

  function setupFrom(raw) {
    const setup = validatePublicSetup(raw, policy);
    if (setup.rainHtlc !== getAddress(chains.rain.address) ||
        setup.ethHtlc !== getAddress(chains.eth.address) ||
        setup.rainToken !== getAddress(tokenAddress)) {
      throw new Error("The public setup does not match Task B's deployed contracts.");
    }
    return setup;
  }

  async function readRecord(asset, id) {
    const chain = chains[asset];
    const view = await recovery.readSide(chain, id, policy.minWindow);
    const swap = plainSwap(view.swap);
    return { swapId: id, swap, block: { number: view.blockNumber, timestamp: view.now },
      recovery: { ...view, swap } };
  }

  //The query allows only two public ids to be passed. The complete agreement will be verified separately. The historical record query does not require a connection to the wallet.
  async function snapshot(raw, rawSetup) {
    const rainId = requireBytes32(raw.rainSwapId, "Rain swap ID");
    const ethId = requireBytes32(raw.ethSwapId, "ETH swap ID");
    await checkNetworks();
    const [rain, eth] = await Promise.all([readRecord("rain", rainId), readRecord("eth", ethId)]);
    const pair = { rain, eth };
    pair.timelocks = assessTimelocks(rain.swap.timelock, eth.swap.timelock,
      rain.block.timestamp, eth.block.timestamp, policy);
    pair.deploymentIssues = deploymentIssues;
    pair.deploymentWarnings = deploymentWarnings;
    if (rawSetup) {
      const setup = setupFrom(rawSetup);
      if (setup.rainSwapId !== rainId || setup.ethSwapId !== ethId) throw new Error("Lookup IDs differ from the selected setup.");
      pair.workflow = workflowState(pair, setup, policy);
      if (deploymentIssues.length) {
        // 历史终态仍如实显示 Completed/Refunded；版本问题单独提示，不能抹去已经确认的结果。
        const terminal = ["Completed", "Refunded"].includes(pair.workflow.phase);
        pair.workflow = { phase: terminal ? pair.workflow.phase : "Deployment review required",
          message: (terminal ? pair.workflow.message + " " : "") + deploymentIssues.join(" "),
          lockRain: false, lockEth: false, claimEth: false, claimRain: false, refundRain: false, refundEth: false };
      }
    }
    return pair;
  }

  // Before a transaction, directly invoke the verifyLock of B2. Do not use the "passed" displayed on the page last time to replace real-time verification.
  async function verifyPair(setup, assets) {
    for (const asset of assets) {
      await protocol.verifyLock(chains[asset].htlc, setup[asset + "SwapId"], expectedLock(setup, asset));
    }
  }

  async function estimate(plan) {
    const chain = chains[plan.asset];
    const contract = plan.action === "approve-rain" ? token : chain.htlc;
    const [gas, fees, balance] = await Promise.all([
      contract[plan.method].estimateGas(...plan.args, { from: plan.sender, value: plan.value }),
      chain.provider.getFeeData(), chain.provider.getBalance(plan.sender)
    ]);
    const modern = fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null;
    const rate = modern ? fees.maxFeePerGas : fees.gasPrice;
    if (rate == null || rate <= 0n) throw new Error("Unable to obtain a usable fee estimate.");
    const gasLimit = (gas * 120n + 99n) / 100n;
    const feeBudget = gasLimit * rate;
    if (balance < plan.value + feeBudget) throw new Error("The sender needs enough ETH for the locked value and gas budget.");
    return { gasLimit, feeBudget, feeOverrides: modern
      ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
      : { gasPrice: fees.gasPrice } };
  }

  // Bob's secret source is only confirmed ETH events and does not accept Alice's private files as substitutes.
  async function observeClaim(setup) {
    const hash = requireBytes32(setup.ethClaimTxHash, "Public ETH claim transaction hash");
    const observed = await recovery.readConfirmedClaim(chains.eth, setup.ethSwapId, hash);
    assertFields(observed.swap, expectedLock(setup, "eth"), "ETH lock");
    return observed;
  }

  // Only the listed business operations are accepted. The client cannot specify any RPC, contract method or transaction target.
  async function prepare({ action, setup: rawSetup, actor, preimage, approvalAmount }) {
    if (deploymentIssues.length) throw new Error(deploymentIssues.join(" "));
    const setup = setupFrom(rawSetup);
    const sender = getAddress(actor);
    const pair = await snapshot(setup);
    let plan;
    if (action === "approve-rain") {
      if (sender !== setup.alice) throw new Error("Select the agreed Alice account.");
      if (typeof approvalAmount !== "string" || !/^\d+(\.\d+)?$/.test(approvalAmount)) throw new Error("Enter a non-negative decimal allowance.");
      const decimals = await token.decimals();
      if (decimals !== 18n) throw new Error("Rain must have 18 decimals.");
      const amount = parseUnits(approvalAmount, decimals);
      const allowance = await token.allowance(sender, chains.rain.address);
      if (amount === allowance) throw new Error("This allowance is already set.");
      if (amount !== 0n && allowance !== 0n) throw new Error("Set the allowance to 0 before changing it to a new amount.");
      plan = { asset: "rain", action, method: "approve", swapId: setup.rainSwapId,
        sender, value: 0n, args: [chains.rain.address, amount], eventName: "Approval" };
    } else if (action === "lock-rain") {
      if (pair.rain.swap.status !== 0n || pair.eth.swap.status !== 0n) throw new Error("One of these swap IDs already exists. Inspect it instead of creating another lock.");
      const at = { blockTag: pair.rain.block.number };
      const [decimals, balance, allowance] = await Promise.all([
        token.decimals(at), token.balanceOf(setup.alice, at), token.allowance(setup.alice, chains.rain.address, at)
      ]);
      const amount = parseUnits(setup.rainAmount, 18);
      if (decimals !== 18n) throw new Error("Rain must have 18 decimals.");
      if (balance < amount) throw new Error("Alice has insufficient Rain.");
      if (allowance < amount) throw new Error("Rain allowance is insufficient. Approve Rain first.");
      const deadline = BigInt(pair.rain.block.timestamp) + BigInt(setup.rainSeconds);
      assertTimeWindows(deadline, BigInt(pair.eth.block.timestamp) + BigInt(setup.ethSeconds),
        pair.rain.block.timestamp, pair.eth.block.timestamp, policy);
      const expected = expectedLock(setup, "rain", deadline);
      plan = { ...protocol.lockCall(setup.rainSwapId, expected),
        asset: "rain", action, swapId: setup.rainSwapId,
        sender: setup.alice, deadline, expected, eventName: "SwapCreated" };
    } else if (action === "lock-eth") {
      await verifyPair(setup, ["rain"]);
      plan = planEthLock(pair, setup, policy);
    } else if (action === "claim-eth") {
      await verifyPair(setup, pair.rain.swap.status === 1n ? ["rain", "eth"] : ["eth"]);
      plan = planEthClaim(pair, setup, preimage, policy);
    } else if (action === "claim-rain") {
      await verifyPair(setup, ["rain"]);
      plan = planRainClaim(pair, setup, await observeClaim(setup));
    } else if (action === "refund-rain" || action === "refund-eth") {
      const asset = action === "refund-rain" ? "rain" : "eth";
      const swapId = setup[asset + "SwapId"];
      const prepared = await recovery.prepareRefund(chains[asset], swapId, policy.minWindow);
      if (!prepared.refundable) throw new Error(prepared.reason);
      assertFields(prepared.view.swap, expectedLock(setup, asset), "Refund lock");
      plan = { asset, action, method: "refund", swapId, sender: prepared.sender,
        value: 0n, args: [swapId], expected: expectedLock(setup, asset), eventName: "SwapRefunded" };
    } else {
      throw new Error("Unsupported swap action.");
    }
    if (getAddress(plan.sender) !== sender) throw new Error("Select the designated sender account for this action.");
    const chain = chains[plan.asset];
    const quote = await estimate(plan);
    // During the RPC fee estimation period, new blocks may be generated, claimed or refunded. Check again within the original candidate period without quietly replacing the parameters corresponding to the quotation.
    const fresh = await snapshot(setup);
    if (action === "lock-rain") {
      if (fresh.rain.swap.status !== 0n || fresh.eth.swap.status !== 0n) throw new Error("A swap was created while preparing this request.");
      assertTimeWindows(plan.deadline, BigInt(fresh.eth.block.timestamp) + BigInt(setup.ethSeconds),
        fresh.rain.block.timestamp, fresh.eth.block.timestamp, policy);
    } else if (action === "lock-eth") {
      planEthLock(fresh, setup, policy);
      assertTimeWindows(fresh.rain.swap.timelock, plan.deadline,
        fresh.rain.block.timestamp, fresh.eth.block.timestamp, policy);
    } else if (action === "claim-eth") {
      planEthClaim(fresh, setup, preimage, policy);
    } else if (action === "claim-rain") {
      planRainClaim(fresh, setup, { swapId: setup.ethSwapId, confirmations: chain.confirmations, preimage: plan.args[1] });
    } else if (action.startsWith("refund-")) {
      const current = await recovery.prepareRefund(chain, plan.swapId, policy.minWindow);
      if (!current.refundable) throw new Error(current.reason);
    }
    const contract = action === "approve-rain" ? token : chain.htlc;
    return { ...plan, quote, transaction: { from: sender,
      to: contract.target, data: contract.interface.encodeFunctionData(plan.method, plan.args),
      value: plan.value, chainId: chain.chainId, gasLimit: quote.gasLimit, ...quote.feeOverrides } };
  }

  //The transaction hash is returned by the wallet
  async function confirm({ action, setup: rawSetup, hash }) {
    const setup = setupFrom(rawSetup);
    if (!["approve-rain", "lock-rain", "lock-eth", "claim-eth", "claim-rain", "refund-rain", "refund-eth"].includes(action)) throw new Error("Unsupported swap action.");
    requireBytes32(hash, "Transaction hash");
    await checkNetworks();
    const asset = ["lock-eth", "claim-eth", "refund-eth"].includes(action) ? "eth" : "rain";
    const chain = chains[asset];
    const contract = action === "approve-rain" ? token : chain.htlc;
    const tx = await chain.provider.getTransaction(hash);
    if (!tx || !tx.to || getAddress(tx.to) !== getAddress(contract.target) || Number(tx.chainId) !== chain.chainId) throw new Error("Transaction target or network does not match this action.");
    const decoded = contract.interface.parseTransaction({ data: tx.data, value: tx.value });
    const method = action.startsWith("lock-") ? asset === "rain" ? "createERC20Swap" : "createETHSwap"
      : action.startsWith("claim-") ? "claim" : action.startsWith("refund-") ? "refund" : "approve";
    if (!decoded || decoded.name !== method) throw new Error("The transaction calls a different operation.");
    const expected = expectedLock(setup, asset);
    const sender = action.startsWith("claim-") ? expected.receiver : expected.sender;
    if (getAddress(tx.from) !== getAddress(sender)) throw new Error("The transaction was sent by a different participant.");
    const swapId = setup[asset + "SwapId"];
    if (action === "approve-rain") {
      if (getAddress(decoded.args[0]) !== getAddress(chain.address) || tx.value !== 0n) throw new Error("Approval targets a different spender.");
    } else {
      if (decoded.args[0].toLowerCase() !== swapId) throw new Error("The transaction belongs to a different swap.");
      if (tx.value !== (action === "lock-eth" ? parseEther(setup.ethAmount) : 0n)) throw new Error("Transaction ETH value mismatch.");
    }
    const receipt = await runtime.confirmed(chain, tx, action);
    const block = await chain.provider.getBlock(receipt.blockNumber);
    if (!block || block.hash !== receipt.blockHash) throw new Error("The transaction receipt is no longer canonical.");
    if (action === "approve-rain") {
      const events = receipt.logs.filter((log) => log.address.toLowerCase() === tokenAddress.toLowerCase())
        .map((log) => { try { return token.interface.parseLog(log); } catch { return null; } })
        .filter((event) => event?.name === "Approval" && getAddress(event.args.owner) === setup.alice &&
          getAddress(event.args.spender) === getAddress(chain.address) && event.args.value === decoded.args[1]);
      if (events.length !== 1 || await token.allowance(setup.alice, chain.address) !== decoded.args[1]) throw new Error("The approval event or current allowance could not be verified.");
      return { hash, asset, action, status: "confirmed" };
    }
    if (action.startsWith("lock-")) {
      const deadline = decoded.args[asset === "rain" ? 5 : 3];
      protocol.verifyCreated(receipt, chain.htlc, swapId, { ...expected, timelock: deadline });
    } else {
      const event = runtime.eventFrom(receipt, chain.htlc, action.startsWith("claim-") ? "SwapClaimed" : "SwapRefunded", swapId);
      if (action.startsWith("claim-") && (event.preimage !== decoded.args[1] || keccak256(event.preimage) !== setup.hashlock)) throw new Error("Claim preimage mismatch.");
    }
    const swap = await chain.htlc.swaps(swapId);
    assertFields(swap, expected, "Confirmed lock");
    const requiredState = action.startsWith("claim-") ? 2n : action.startsWith("refund-") ? 3n : null;
    if (requiredState === null ? swap.status === 0n : swap.status !== requiredState) throw new Error("The expected on-chain result could not be verified.");
    return { hash, asset, action, status: "confirmed", swap: plainSwap(swap) };
  }

  async function transactionStatus({ asset, hash }) {
    if (!Object.hasOwn(chains, asset) || !isHexString(hash, 32)) throw new Error("Invalid transaction lookup.");
    await runtime.assertChain(chains[asset]);
    const receipt = await chains[asset].provider.getTransactionReceipt(hash);
    return receipt ? { status: receipt.status } : null;
  }
  return { snapshot, prepare, confirm, transactionStatus, deploymentIssues, deploymentWarnings };
}

export async function configuredCoordinator() {
  const chains = {};
  const deploymentIssues = [];
  const deploymentWarnings = [];
  try {
    for (const [asset, key] of [["rain", "sepolia"], ["eth", "arbitrumSepolia"]]) {
      const meta = networks[key];
      const deployment = require("../../deployments/" + key + ".json");
      if (deployment.chainId !== meta.chainId || deployment.status !== "confirmed") {
        throw new Error(meta.name + ": use a confirmed deployment record for the expected chain.");
      }
      const abi = require("../../config/abi/" + meta.contract + ".json");
      const fallback = asset === "rain" ? "https://ethereum-sepolia-rpc.publicnode.com" : "https://sepolia-rollup.arbitrum.io/rpc";
      const request = new FetchRequest(process.env[meta.rpcEnv] || fallback);
      request.timeout = 20000;
      const provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
      const chain = { ...meta, key, provider, address: getAddress(deployment.address),
        confirmations: 2, timeout: 180000 };
      chains[asset] = chain;
      chain.htlc = new Contract(chain.address, abi, provider);
      await runtime.assertChain(chain);
      try {
        const checked = await runtime.assertCode(chain, chain.address, meta.contract);
        if (checked.warning) deploymentWarnings.push(checked.warning);
      } catch (error) {
        if (error.code !== "HTLC_CODE_MISMATCH") throw error;
        deploymentIssues.push(error.message + ". Historical reads remain available; transaction preparation is blocked.");
      }
    }
    const deployment = require("../../deployments/sepolia.json");
    const service = createCoordinator(chains, deployment.rainAddress, DEFAULT_POLICY, deploymentIssues, deploymentWarnings);
    return { service, close: () => runtime.close(chains) };
  } catch (error) {
    runtime.close(chains);
    const message = runtime.errorMessage(new Error(safeErrorMessage(error)));
    throw new Error(message === "AggregateError"
      ? "Cannot connect to Task B's RPC endpoints. Check the network and local RPC configuration."
      : message);
  }
}
