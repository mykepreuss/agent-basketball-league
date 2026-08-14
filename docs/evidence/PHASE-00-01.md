# Phase 0-1 evidence: discovery, constitution, schemas, and threat model

Recorded: 2026-08-12, America/Vancouver.

## Outcome

Discovery and the constitutional/schema baseline pass locally. Live Blaxel staging does not pass and was not attempted: the authenticated account exposes only `knicks`, and Agent Drive is disabled. These are explicitly carried into phase 2 without weakening the four-workspace or encrypted-broker design.

## Reproducible checks

Commands:

```sh
corepack pnpm format:check
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

Environment:

- macOS arm64 workspace
- Node `24.7.0` local (warning because release target is pinned `24.18.0`)
- pnpm `11.21.0`
- Turborepo `2.10.9`
- TypeScript `6.0.3`
- Vitest `4.1.10`

Results:

- Formatting: pass, all tracked source/doc/config files.
- Typechecking: 2/2 packages pass under strict TypeScript.
- Tests: 2/2 files, 8/8 tests pass.
- Build: 2/2 packages pass.
- Schema coverage: all 43 primary plan-named interfaces are registered; every exported top-level JSON Schema is draft 2020-12, object-typed, and `additionalProperties: false`.
- Safety schema: a free-text safety payload fails closed.
- NBA mapping: 14 rules plus Comments, 15/15 classified.
- CBA mapping: 42/42 articles and 17/17 exhibits classified with citation, rationale, implementation reference, governing body, and tests.
- Constitutional constants: 12 explicit non-negotiable invariants and the higher/expiring thresholds pass.

## Artifact digests after formatting

- `pnpm-lock.yaml`: `sha256:3db235a32ac1762eaf1fb8dda692f1c76c52c238d4265287c3e039154db5f038`
- NBA mapping: `sha256:82d3bcd538f87fbb2696a4f846b711947827e85015c85130f5d80024a42b8c0c`
- CBA mapping: `sha256:967ac13d7d5d315559fcbf7de25680f8d8acc6ad4481c1247738dd3cfba83be2`
- Founding constitution: `sha256:f4bd80b5da2005e0d2578cf730b0f07032b991bbc358b26233d5f8531e3a223f`
- Threat model: `sha256:e9b0f79b19235b80ac57ebaa061c74746f59c08057b7c2aa12be941affea90e0`
- Verifier rules: `sha256:8ca1ee0ac7348b6b573d23e988b5a38c3816431222ab8b94381aaaa871d0f645`
- Retrieved source manifest: `sha256:96af79374ce786ec05e72c4b6f0f6153e62994aee6466f56c2bad80a4119322c`

## Source-document verification

The official 2023 CBA PDF was downloaded to an untracked temporary directory, reported as 676 pages, extracted with Poppler, and its 24-page table of contents rendered at 100 DPI. Representative first, middle, and final contents pages were visually inspected and matched the extracted 42-article/17-exhibit structure. PDF SHA-256: `bf178ca0f2d64f9dfe6fde095d3ae43d576b12e19ce7a679618d632584f7ab32`.

The mapping records titles/locators and ABL analysis only; it does not redistribute protected CBA or NBA rule prose.

## Limitations carried forward

1. Target Node 24.18.0 has not yet executed the suite; the older local Node 24.7.0 passed with an intentional engine warning. The custom image must prove the exact target.
2. Image/container/kernel/tool/migration digests do not exist until the phase-2 foundation is built.
3. Classification `implementationRef` paths describe the approved implementation targets; subsequent phases must create them and the final coverage gate rejects missing references.
4. The constitutional documents remain proposals until founding-agent ratification; passing software tests does not ratify them.
