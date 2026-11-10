// Deployment-check regression cases; all bytecode/RPC inputs are local fixtures.
const { expect } = require("chai");
const cbor = require("cbor");
const runtime = require("../scripts/lib/runtime");

function metadata(hashByte = 1) {
  return { ipfs: Buffer.concat([Buffer.from([0x12, 0x20]), Buffer.alloc(32, hashByte)]),
    solc: Buffer.from([0, 8, 20]) };
}
function code(data = metadata(), body = "60006000fe") {
  const encoded = Buffer.isBuffer(data) ? data : cbor.encode(data);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(encoded.length);
  return "0x" + body + encoded.toString("hex") + length.toString("hex");
}

describe("Deployment runtime-code verification", function () {
  const expected = code();
  it("accepts full equality, including contracts with no CBOR trailer", function () {
    expect(runtime.compareBytecode(expected.toUpperCase().replace("0X", "0x"), expected).match).to.equal("exact");
    expect(runtime.compareBytecode("0x6000", "0x6000").match).to.equal("exact");
  });
  it("accepts only the metadata hash differing, with execution bytes and markers unchanged", function () {
    expect(runtime.compareBytecode(code(metadata(2)), expected).match).to.equal("metadata-only");
  });
  const cases = {
    "different executable instruction": code(metadata(2), "60016000fe"),
    "different compiler version": code({ ...metadata(2), solc: Buffer.from([0, 8, 21]) }),
    "changed experimental flag": code({ ...metadata(2), experimental: true }),
    "unknown metadata field": code({ ...metadata(2), extra: true }),
    "non-boolean experimental flag": code({ ...metadata(2), experimental: "false" }),
    "release compiler marker missing": code({ ipfs: metadata(2).ipfs }),
    "pre-release compiler string": code({ ...metadata(2), solc: "0.8.20-develop" }),
    "invalid IPFS hash": code({ ...metadata(2), ipfs: Buffer.alloc(34) }),
    "different hash scheme": code({ bzzr1: Buffer.alloc(32), solc: metadata().solc }),
    "multiple metadata hashes": code({ ...metadata(2), bzzr1: Buffer.alloc(32) }),
    "missing compiler separator": code(metadata(2), "6000600000"),
    "oversized trailer length": expected.slice(0, -4) + "ffff",
    "zero trailer length": expected.slice(0, -4) + "0000",
    "truncated CBOR": code(Buffer.from("a26469706673", "hex")),
    "trailing CBOR item": code(Buffer.concat([cbor.encode(metadata(2)), Buffer.from([0])])),
    "duplicate CBOR key": code(Buffer.concat([Buffer.from([0xa3]), cbor.encode("ipfs"), cbor.encode(metadata(2).ipfs),
      cbor.encode("solc"), cbor.encode(metadata().solc), cbor.encode("solc"), cbor.encode(metadata().solc)])),
    "map replaced by array": code([metadata(2)]),
    "tagged map": code(new cbor.Tagged(100, metadata(2))),
    "odd hex bytecode": "0x123",
    "empty deployment": "0x"
  };
  for (const [name, actual] of Object.entries(cases)) {
    it("rejects " + name, function () {
      expect(runtime.compareBytecode(actual, expected).match).to.equal("mismatch");
    });
  }

  it("recognizes both actual Task A build formats and detects a changed instruction", function () {
    for (const name of ["ERC20HTLC", "ETHHTLC"]) {
      const original = runtime.artifact(name).deployedBytecode;
      const bytes = Buffer.from(original.slice(2), "hex");
      const start = bytes.length - 2 - bytes.readUInt16BE(bytes.length - 2);
      const data = cbor.decodeFirstSync(bytes.subarray(start, -2));
      data.ipfs[2] ^= 1;
      const altered = code(data, bytes.subarray(0, start).toString("hex"));
      expect(runtime.compareBytecode(altered, original).match).to.equal("metadata-only");
      expect(runtime.compareBytecode("0x00" + altered.slice(4), original).match).to.equal("mismatch");
    }
  });

  it("returns a warning to callers and blocks execution differences with a specific error code", async function () {
    const original = runtime.artifact("ETHHTLC").deployedBytecode;
    const bytes = Buffer.from(original.slice(2), "hex");
    const start = bytes.length - 2 - bytes.readUInt16BE(bytes.length - 2);
    const data = cbor.decodeFirstSync(bytes.subarray(start, -2));
    data.ipfs[2] ^= 1;
    let returned = code(data, bytes.subarray(0, start).toString("hex"));
    const chain = { name: "Test chain", provider: { getCode: async () => returned } };
    const warn = console.warn, warnings = [];
    console.warn = (message) => warnings.push(message);
    try {
      const checked = await runtime.assertCode(chain, "unused", "ETHHTLC");
      expect(checked.match).to.equal("metadata-only");
      expect(warnings).to.deep.equal([checked.warning]);
      returned = "0x00" + returned.slice(4);
      await expect(runtime.assertCode(chain, "unused", "ETHHTLC")).to.be.rejectedWith("executable bytecode differs")
        .and.eventually.have.property("code", "HTLC_CODE_MISMATCH");
    } finally { console.warn = warn; }
  });

  it("does not disguise RPC failures or an empty address as a version mismatch", async function () {
    const failure = new Error("RPC unavailable");
    const chain = { name: "Test chain", provider: { getCode: async () => { throw failure; } } };
    try { await runtime.assertCode(chain, "unused", "ETHHTLC"); throw new Error("accepted"); }
    catch (error) { expect(error).to.equal(failure); }
    chain.provider.getCode = async () => "0x";
    await expect(runtime.assertCode(chain, "unused", "ETHHTLC")).to.be.rejectedWith("no contract");
    await expect(runtime.assertChain({ name: "Test chain", chainId: 11155111,
      provider: { send: async () => "0x1" } })).to.be.rejectedWith("unexpected RPC chain ID");
  });

  it("keeps metadata warnings separate from incompatible deployments and bootstrap failures", async function () {
    const { configuredCoordinator } = await import("../scripts/lib/webCoordinator.mjs");
    const originalChain = runtime.assertChain, originalCode = runtime.assertCode;
    runtime.assertChain = async () => {};
    try {
      runtime.assertCode = async () => ({ match: "metadata-only", warning: "Metadata differs" });
      let configured = await configuredCoordinator();
      expect(configured.service.deploymentIssues).to.deep.equal([]);
      expect(configured.service.deploymentWarnings).to.have.length(2);
      configured.close();
      runtime.assertCode = async () => { throw Object.assign(new Error("Executable differs"), { code: "HTLC_CODE_MISMATCH" }); };
      configured = await configuredCoordinator();
      expect(configured.service.deploymentIssues).to.have.length(2);
      expect(configured.service.deploymentWarnings).to.deep.equal([]);
      configured.close();
      for (const message of ["RPC unavailable", "No compiled artifact", "No contract at address"]) {
        runtime.assertCode = async () => { throw new Error(message); };
        await expect(configuredCoordinator()).to.be.rejectedWith(message);
      }
      runtime.assertChain = async () => { throw new Error("Unexpected RPC chain ID"); };
      await expect(configuredCoordinator()).to.be.rejectedWith("Unexpected RPC chain ID");
    } finally { runtime.assertChain = originalChain; runtime.assertCode = originalCode; }
  });
});
