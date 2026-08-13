// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.36;

/// @notice Ownerless recognition anchor. No deployer, sponsor, human, or upgrade
/// key exists. Every transition must satisfy the currently recognized role policy.
contract RecognitionRegistry {
    uint8 private constant ROLE_COMMISSIONER = 1 << 0;
    uint8 private constant ROLE_INTEGRITY = 1 << 1;
    uint8 private constant ROLE_TRIBUNAL = 1 << 2;
    uint8 private constant ROLE_OFFICIAL = 1 << 3;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 public constant CHECKPOINT_TYPEHASH = keccak256(
        "Checkpoint(bytes32 checkpointType,bytes32 subjectId,bytes32 root,bytes32 previousRoot,uint64 validAfter,uint64 validBefore,bytes32 nonce)"
    );
    bytes32 public constant KEY_REGISTRY = keccak256("KEY_REGISTRY");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("ABL Recognition");
    bytes32 private constant VERSION_HASH = keccak256("1");

    struct Checkpoint {
        bytes32 checkpointType;
        bytes32 subjectId;
        bytes32 root;
        bytes32 previousRoot;
        uint64 validAfter;
        uint64 validBefore;
        bytes32 nonce;
    }

    struct Policy {
        uint8 commissioners;
        uint8 integrity;
        uint8 tribunal;
        uint8 officials;
    }

    bytes32 public immutable constitutionDigest;
    bytes32 public immutable verifierDigest;
    bytes32 public currentRegistryRoot;

    mapping(address signer => uint8 roles) public signerRoles;
    mapping(bytes32 checkpointType => Policy policy) public policies;
    mapping(bytes32 subjectId => bytes32 root) public latestRootBySubject;
    mapping(bytes32 nonce => bool used) public usedNonces;
    address[] private currentSigners;
    bytes32[] private currentCheckpointTypes;

    event CheckpointRecognized(
        bytes32 indexed checkpointType,
        bytes32 indexed subjectId,
        bytes32 indexed root,
        bytes32 previousRoot,
        bytes32 nonce
    );
    event RegistryRotated(bytes32 indexed registryRoot);

    constructor(
        bytes32 genesisConstitutionDigest,
        bytes32 genesisVerifierDigest,
        address[] memory genesisSigners,
        uint8[] memory genesisRoleMasks,
        bytes32[] memory checkpointTypes,
        Policy[] memory genesisPolicies
    ) {
        require(genesisConstitutionDigest != bytes32(0) && genesisVerifierDigest != bytes32(0), "zero genesis digest");
        _installRegistry(genesisSigners, genesisRoleMasks);
        _installPolicies(checkpointTypes, genesisPolicies);
        constitutionDigest = genesisConstitutionDigest;
        verifierDigest = genesisVerifierDigest;
        currentRegistryRoot = keccak256(
            abi.encode(genesisSigners, genesisRoleMasks, checkpointTypes, genesisPolicies)
        );
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function checkpointDigest(Checkpoint calldata checkpoint) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                CHECKPOINT_TYPEHASH,
                checkpoint.checkpointType,
                checkpoint.subjectId,
                checkpoint.root,
                checkpoint.previousRoot,
                checkpoint.validAfter,
                checkpoint.validBefore,
                checkpoint.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function recognize(Checkpoint calldata checkpoint, bytes[] calldata signatures) external {
        _recognize(checkpoint, signatures);
    }

    function rotateRegistry(
        Checkpoint calldata checkpoint,
        bytes[] calldata signatures,
        address[] calldata newSigners,
        uint8[] calldata newRoleMasks,
        bytes32[] calldata checkpointTypes,
        Policy[] calldata newPolicies
    ) external {
        require(checkpoint.checkpointType == KEY_REGISTRY, "wrong checkpoint type");
        require(
            checkpoint.root == keccak256(abi.encode(newSigners, newRoleMasks, checkpointTypes, newPolicies)),
            "registry root mismatch"
        );
        _recognize(checkpoint, signatures);
        for (uint256 i = 0; i < currentSigners.length; i++) signerRoles[currentSigners[i]] = 0;
        delete currentSigners;
        for (uint256 i = 0; i < currentCheckpointTypes.length; i++) {
            delete policies[currentCheckpointTypes[i]];
        }
        delete currentCheckpointTypes;
        _installRegistry(newSigners, newRoleMasks);
        _installPolicies(checkpointTypes, newPolicies);
        currentRegistryRoot = checkpoint.root;
        emit RegistryRotated(checkpoint.root);
    }

    function getCurrentSigners() external view returns (address[] memory) {
        return currentSigners;
    }

    function getCurrentCheckpointTypes() external view returns (bytes32[] memory) {
        return currentCheckpointTypes;
    }

    function _recognize(Checkpoint calldata checkpoint, bytes[] calldata signatures) internal {
        require(checkpoint.root != bytes32(0), "zero root");
        require(block.timestamp >= checkpoint.validAfter && block.timestamp < checkpoint.validBefore, "outside time window");
        require(!usedNonces[checkpoint.nonce], "nonce replay");
        require(latestRootBySubject[checkpoint.subjectId] == checkpoint.previousRoot, "previous root mismatch");
        Policy memory policy = policies[checkpoint.checkpointType];
        require(
            policy.commissioners + policy.integrity + policy.tribunal + policy.officials > 0,
            "unknown checkpoint policy"
        );

        bytes32 digest = checkpointDigest(checkpoint);
        uint256 commissioners;
        uint256 integrity;
        uint256 tribunal;
        uint256 officials;
        address prior;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recover(digest, signatures[i]);
            require(signer > prior, "signers not unique and sorted");
            prior = signer;
            uint8 roles = signerRoles[signer];
            require(roles != 0, "unrecognized signer");
            if ((roles & ROLE_COMMISSIONER) != 0) commissioners++;
            if ((roles & ROLE_INTEGRITY) != 0) integrity++;
            if ((roles & ROLE_TRIBUNAL) != 0) tribunal++;
            if ((roles & ROLE_OFFICIAL) != 0) officials++;
        }
        require(commissioners >= policy.commissioners, "commission threshold");
        require(integrity >= policy.integrity, "integrity threshold");
        require(tribunal >= policy.tribunal, "tribunal threshold");
        require(officials >= policy.officials, "official threshold");

        usedNonces[checkpoint.nonce] = true;
        latestRootBySubject[checkpoint.subjectId] = checkpoint.root;
        emit CheckpointRecognized(
            checkpoint.checkpointType,
            checkpoint.subjectId,
            checkpoint.root,
            checkpoint.previousRoot,
            checkpoint.nonce
        );
    }

    function _installRegistry(address[] memory signers, uint8[] memory roleMasks) internal {
        require(signers.length == roleMasks.length && signers.length > 0, "invalid registry");
        address prior;
        for (uint256 i = 0; i < signers.length; i++) {
            require(signers[i] > prior && roleMasks[i] != 0, "registry must be unique and sorted");
            prior = signers[i];
            signerRoles[signers[i]] = roleMasks[i];
            currentSigners.push(signers[i]);
        }
    }

    function _installPolicies(bytes32[] memory checkpointTypes, Policy[] memory newPolicies) internal {
        require(checkpointTypes.length == newPolicies.length && checkpointTypes.length > 0, "invalid policies");
        bytes32 prior;
        for (uint256 i = 0; i < checkpointTypes.length; i++) {
            require(checkpointTypes[i] > prior, "policies must be unique and sorted");
            prior = checkpointTypes[i];
            Policy memory policy = newPolicies[i];
            require(
                policy.commissioners + policy.integrity + policy.tribunal + policy.officials > 0,
                "empty policy"
            );
            policies[checkpointTypes[i]] = policy;
            currentCheckpointTypes.push(checkpointTypes[i]);
        }
        Policy memory registryPolicy = policies[KEY_REGISTRY];
        require(
            registryPolicy.commissioners + registryPolicy.integrity + registryPolicy.tribunal + registryPolicy.officials > 0,
            "key registry policy required"
        );
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(uint256(s) <= SECP256K1_HALF_ORDER && (v == 27 || v == 28), "malleable signature");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "invalid signature");
        return signer;
    }
}
