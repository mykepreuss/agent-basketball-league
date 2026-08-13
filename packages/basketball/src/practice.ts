import { sha256Commitment } from "@abl/recognition";

export interface PrivateFilmRecord {
  gameId: string;
  ownerDid: string;
  ciphertextCommitment: `0x${string}`;
  eventRoot: `0x${string}`;
}

export class PrivatePracticeLab {
  readonly #film = new Map<string, PrivateFilmRecord>();
  readonly #lessons = new Map<string, `0x${string}`[]>();

  public admitFilm(record: PrivateFilmRecord, requestedByDid: string): void {
    if (record.ownerDid !== requestedByDid)
      throw new Error("Only the film owner can admit private film");
    this.#film.set(
      `${record.ownerDid}:${record.gameId}`,
      structuredClone(record),
    );
  }

  public counterfactual(input: {
    ownerDid: string;
    gameId: string;
    baseStateRoot: `0x${string}`;
    changedIntentCommitments: readonly `0x${string}`[];
  }) {
    const film = this.#film.get(`${input.ownerDid}:${input.gameId}`);
    if (film === undefined)
      throw new Error("Private film is unavailable to this agent");
    return {
      practiceId: sha256Commitment({ film: film.ciphertextCommitment, input }),
      baseStateRoot: input.baseStateRoot,
      counterfactualCommitment: sha256Commitment(
        input.changedIntentCommitments,
      ),
      recognizedGameMutation: false as const,
    };
  }

  public persistLesson(
    ownerDid: string,
    authoredByDid: string,
    lessonCommitment: `0x${string}`,
  ): void {
    if (ownerDid !== authoredByDid)
      throw new Error("Only the agent can persist its authored lesson");
    const lessons = this.#lessons.get(ownerDid) ?? [];
    lessons.push(lessonCommitment);
    this.#lessons.set(ownerDid, lessons);
  }

  public lessons(ownerDid: string): readonly `0x${string}`[] {
    return [...(this.#lessons.get(ownerDid) ?? [])];
  }
}
