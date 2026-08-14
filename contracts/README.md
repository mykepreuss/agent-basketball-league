# Recognition contract workflow

`RecognitionRegistry.sol` contains no owner, proxy, upgrade, pause, sponsor, or deployer mutation authority. Genesis installs sorted institutional signer addresses, role masks, and per-checkpoint role thresholds. Registry or policy rotation is possible only through a `KEY_REGISTRY` checkpoint that passes the old registry's policy and whose root commits the complete replacement.

Run `pnpm contract:prepare -- <config.json> <output.json>` to compile with pinned Solidity `0.8.36` and prepare a Base Sepolia contract-creation transaction. The command is deliberately prepare-only: it rejects any chain other than `84532`, never reads a private key or RPC URL, and never broadcasts. Its creation-bytecode hash identifies the transaction input; it deliberately leaves the deployed-runtime-bytecode hash null. After an approval-gated deployment, that separate runtime hash must be obtained from `eth_getCode` and independently verified before any public checkpoint can be canonical. The example values are non-secret placeholders and are not genesis authorization.

Local compilation is part of the recognition suite. An EVM execution suite and funded Base Sepolia broadcast remain external; irreversible ownerless production deployment is a mandatory explicit-approval gate.
