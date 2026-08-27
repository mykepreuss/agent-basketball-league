# Neutral-official deployment templates

These templates extend the existing career-body and fixed-broker runtime; they
do not define a parallel career implementation. Resolve one career and one
fixed-broker manifest for each exact career in `resource-plan.json`.

Deployment remains disabled until all of the following are true:

- a dedicated `abl-neutral-official-model` Model Gateway exists in the existing
  `agent-basketball-league` workspace;
- its immutable model identity and credential are read back without using the
  unrelated `sandbox-openai` route;
- eight career identities are created inside their career Sandboxes;
- only the corresponding fixed brokers receive the model credential;
- all eight careers are recorded as ineligible for founding and governance
  voting authority; and
- the bounded multi-role acceptance proof passes without activating Genesis.

The templates use no Blaxel Agent, Application, Volume, or additional
workspace.
