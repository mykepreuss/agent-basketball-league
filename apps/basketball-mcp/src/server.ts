import {
  FinalizedGamePayloadSchema,
  FullGameEngine,
  FullGameInputSchema,
  GameCommandSchema,
  BasketballStateSchema,
  PossessionInputWireSchema,
  materializePossessionInput,
  observePlayer,
  replayFinalizedGamePayload,
  resolvePossession,
} from "@abl/basketball";
import { createMcpServer, defineMcpTool } from "@abl/mcp-protocol";
import { z } from "zod";

const ResolveGameCommandsInputSchema = z.strictObject({
  input: FullGameInputSchema,
  commands: z.array(GameCommandSchema).min(1).max(10_000),
});
const VerifyFinalizedGameInputSchema = z.strictObject({
  payload: FinalizedGamePayloadSchema,
});
const ObservePlayerInputSchema = z.strictObject({
  state: BasketballStateSchema,
  playerId: z.string().min(1).max(100),
});
const ResolveSignedPossessionInputSchema = z.strictObject({
  possession: PossessionInputWireSchema,
});

export function createBasketballMcp(
  options: {
    allowedOrigins?: ReadonlySet<string>;
  } = {},
): ReturnType<typeof createMcpServer> {
  const tools = [
    defineMcpTool({
      name: "observe_player",
      description:
        "Derive one player's partial observation from committed basketball state without exposing hidden state.",
      inputSchema: ObservePlayerInputSchema,
      execute: ({ state, playerId }) => observePlayer(state, playerId),
    }),
    defineMcpTool({
      name: "resolve_signed_possession",
      description:
        "Verify all player, coach, referee, and replay authorizations and resolve one possession deterministically.",
      inputSchema: ResolveSignedPossessionInputSchema,
      execute: async ({ possession }) => {
        const result = await resolvePossession(
          materializePossessionInput(possession),
        );
        return {
          finalState: result.finalState,
          events: result.events,
          segments: result.segments,
          eventMerkleRoot: result.eventMerkleRoot,
          finalStateRoot: result.finalStateRoot,
          randomCounter: result.randomCounter.toString(),
          filmCommitment: result.filmCommitment,
          inferenceInvocations: 0,
        };
      },
    }),
    defineMcpTool({
      name: "resolve_game_commands",
      description:
        "Apply ordered basketball commands to the deterministic ABL game state machine without invoking a model.",
      inputSchema: ResolveGameCommandsInputSchema,
      execute: ({ input, commands }) => {
        const game = new FullGameEngine(input);
        for (const command of commands) game.apply(command);
        return {
          state: game.snapshot(),
          events: game.events(),
          proof: game.proof(),
          commandCount: game.commands().length,
          inferenceInvocations: 0,
        };
      },
    }),
    defineMcpTool({
      name: "verify_finalized_game",
      description:
        "Validate a finalized agent-played game payload and replay it exactly from recorded commands.",
      inputSchema: VerifyFinalizedGameInputSchema,
      execute: ({ payload }) => {
        const replay = replayFinalizedGamePayload(payload);
        return {
          exact: true,
          finalState: replay.state,
          eventCount: replay.events.length,
          proof: replay.payload.proof,
          agentEvidenceCommitment:
            replay.payload.agentEvidence.evidenceCommitment,
          inferenceInvocations: 0,
        };
      },
    }),
  ];
  return createMcpServer({
    name: "abl-basketball",
    version: "0.0.0-pre-genesis",
    tools,
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
  });
}
