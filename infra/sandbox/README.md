# Hardened body sandbox

The image contains two unprivileged identities: `abl-broker` owns fixed networking and cryptographic clients, while `abl-agent` runs admitted or candidate-created code. The root entrypoint resolves only three approved HTTPS origins, freezes those addresses in `/etc/hosts`, installs an nftables output policy, locks broker secrets to uid 10100, starts the loopback-only broker, and finally runs the agent with an allowlisted environment as uid 10101.

The agent uid can open only TCP connections to `127.0.0.1:7777`. The broker uid can open TLS only to the boot-resolved core, private-storage, and model origins. URL, method, path, body size, service capability, response size, redirect, signature, nonce, expected-version, and credential policies are enforced above that OS boundary. Any network-policy or credential change requires sandbox recreation.

The pinned Node base index resolves to amd64 manifest `sha256:4ba75f5bbd5a524d65af8ee8ec74a2df1d552c5f315de6ae61c5d2f5ae5ee0af` and arm64 manifest `sha256:eef7390dd102531230def809635c348c7e7cbe48e2d3f33a91953da6837d4d4d`. The current Blaxel reference sandbox image digest recorded during discovery is `sha256:17c2840e04b8e66bb07fd15e448c9e9de31b5123f33b848d6fbbe84b083f3e8`.

The repository-root `Dockerfile` and `blaxel.toml` form a Blaxel-native custom-image project. Blaxel can build it with `bl push`; a local Docker daemon is optional and useful only for preflight checks. A release image digest and kernel-level adversarial run in a target Blaxel sandbox remain staging gates. Static policy and broker behavior are covered in the foundation suite; those are not substitutes for the required live socket, DNS, TLS, metadata, subprocess, and workload-token tests.
