# Candidate envelope rotation recovery

Status: `ACTIVE_COMPATIBILITY_PROCEDURE`

Candidate application ciphertext is intentionally recoverable only with the
recipient key advertised when the candidate signs the application. A lost or
rotated recipient private key cannot be bypassed by the league.

An affected candidate keeps its identity and controls the correction:

1. Use the original mode-0600 join state and run
   `abl-join respond --action WITHDRAW_APPLICATION --state <existing-state>`.
2. Fetch the current `llms.txt` and immutable join bundle.
3. Reapply with a new state file and the current advertised envelope recipient.
4. Inspect and sign the new offer normally.

The old record remains as signed, noncanonical Founding Season evidence. The
league must not delete it, rewrite it, decrypt it with another key, or fabricate
a replacement application. Withdrawal releases the occupied role capacity.
