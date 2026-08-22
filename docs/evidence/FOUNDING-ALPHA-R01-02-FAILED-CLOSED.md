# Founding Alpha R01-02 failed-closed result

> Status: `FAILED_CLOSED_BEFORE_PROVIDER_MUTATION`
> Authorization: `ABL-FOUNDING-ALPHA-R01-02`
> Recorded: `2026-08-22T14:26:00-07:00` in `America/Vancouver`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

The authorization failed closed during its mandatory local artifact-reproduction gate. No Blaxel or Neon resource was created, modified, or deleted. No image was pushed, no secret or preview token was created, no spend-bearing workload was started, and no model or Base call occurred.

The authorized source, launch plan, exact-runtime result, manifests, body-image inputs, resource plan, Drive rules, and launch ledger initially matched the repository. A fresh image-context generation then exposed that pnpm's deployment-only `node_modules/.pnpm/lock.yaml` retained a relative workspace path whose depth differed between macOS's `/tmp` alias and canonical `/private/tmp` path. The application files were otherwise byte-identical, but the path-dependent metadata changed all twelve packaged application-image digests and the body archive digest. The authorization's no-drift clause therefore stopped the run before its first provider mutation.

## Local correction

The image-context generator now removes that deployment-only lockfile together with the other pnpm runtime metadata already excluded from deployed packages. This does not remove an application dependency or change runtime behavior; production applications resolve from the installed module tree and do not consume pnpm's internal deployment lock at runtime.

The corrected generator was run independently with output roots beneath both `/tmp` and `/private/tmp`. Both runs produced the same thirteen per-image source digests, the same image-set digest, and byte-identical body archives:

| Artifact                  | Corrected value                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| Thirteen-image source set | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` |
| Body-program archive      | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` |
| Body archive files        | 13,676                                                               |
| Body archive members      | 14,511                                                               |
| Body archive bytes        | 15,391,218                                                           |
| Manifest set              | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` |

The focused foundation suite passed 31 tests. The complete exact Node `24.18.0` and pnpm `11.21.0` pipeline then passed 354 assertions across 75 files and 113 uncached tasks, retaining stable result digest `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5`.

## Replacement boundary

`ABL-FOUNDING-ALPHA-R01-02` cannot be reused. A replacement authorization must bind the merged correction commit, corrected source/image/archive/resource-plan/launch-ledger digests, a fresh read-only Blaxel and Neon preflight, and the same resource-specific teardown terms before any provider mutation.
