import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const PRIVATE_FILM_AGGREGATE_TYPE = "private-film-catalog";
export const FILM_ADMITTED_EVENT_TYPE = "FilmAdmitted";
export const FILM_INSPECTED_EVENT_TYPE = "FilmInspected";
export const PRIVATE_PRACTICE_AGGREGATE_TYPE = "private-practice-ledger";
export const PRACTICE_RUN_EVENT_TYPE = "PracticeCounterfactualRun";
export const PRACTICE_LESSON_EVENT_TYPE = "PracticeLessonPersisted";
export const PRACTICE_INSPECTED_EVENT_TYPE = "PracticeInspected";

export const PrivateFilmStorageReferenceSchema = z.strictObject({
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  ciphertextCommitment: Sha256Schema,
});

export const CanonicalPrivateFilmRecordSchema = z.strictObject({
  filmId: UuidV7Schema,
  gameId: UuidV7Schema,
  ownerDid: DidSchema,
  sourceFilmCommitment: Sha256Schema,
  eventRoot: Sha256Schema,
  finalStateRoot: Sha256Schema,
  storage: PrivateFilmStorageReferenceSchema,
  admittedAt: IsoDateTimeSchema,
});

export const FilmAdmittedPayloadSchema = z.strictObject({
  film: CanonicalPrivateFilmRecordSchema,
});

export const FilmInspectedPayloadSchema = z.strictObject({
  ownerDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-PRIVATE-FILM-CATALOG-INSPECTION-V1"),
});

export const FilmDeliveryEvidenceSchema = z.strictObject({
  gameId: UuidV7Schema,
  ownerDid: DidSchema,
  ciphertextCommitment: Sha256Schema,
  deliveryCommitment: Sha256Schema,
});

export const FilmDeliveryEvidenceRegistrySchema = z
  .array(FilmDeliveryEvidenceSchema)
  .max(1_000)
  .refine(
    (entries) =>
      new Set(entries.map(({ gameId, ownerDid }) => `${gameId}:${ownerDid}`))
        .size === entries.length,
    "Film delivery evidence must have unique game/owner pairs",
  );

export type CanonicalPrivateFilmRecord = z.infer<
  typeof CanonicalPrivateFilmRecordSchema
>;
export type PrivateFilmStorageReference = z.infer<
  typeof PrivateFilmStorageReferenceSchema
>;
export type FilmDeliveryEvidence = z.infer<typeof FilmDeliveryEvidenceSchema>;

export interface FilmDeliveryEvidenceReader {
  filmDeliveryEvidence(
    gameId: string,
    ownerDid: string,
  ): Promise<FilmDeliveryEvidence | null>;
}

function filmDeliveryBody(evidence: FilmDeliveryEvidence) {
  const { deliveryCommitment: _deliveryCommitment, ...body } = evidence;
  return body;
}

export function createFilmDeliveryEvidenceReader(
  input: unknown,
): FilmDeliveryEvidenceReader {
  const registry = FilmDeliveryEvidenceRegistrySchema.parse(input);
  for (const evidence of registry) {
    if (
      sha256Commitment(filmDeliveryBody(evidence)) !==
      evidence.deliveryCommitment
    ) {
      throw new Error("Film delivery evidence commitment is invalid");
    }
  }
  const evidenceByGameOwner = new Map(
    registry.map((evidence) => [
      `${evidence.gameId}:${evidence.ownerDid}`,
      structuredClone(evidence),
    ]),
  );
  return {
    filmDeliveryEvidence: async (gameId, ownerDid) =>
      structuredClone(evidenceByGameOwner.get(`${gameId}:${ownerDid}`) ?? null),
  };
}

export const PRIVATE_FILM_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-private-film-catalog",
  version: 1,
  aggregateType: PRIVATE_FILM_AGGREGATE_TYPE,
  eventTypes: [FILM_ADMITTED_EVENT_TYPE, FILM_INSPECTED_EVENT_TYPE],
  contentMode: "commitments-only",
  disclosureClass: "PERSONAL_UNSUBMITTED",
});

export function privateFilmCatalogStateRoot(
  ownerDid: string,
  aggregateVersion: number,
  records: ReadonlyMap<string, CanonicalPrivateFilmRecord>,
): Hex {
  return sha256Commitment({
    format: "ABL-PRIVATE-FILM-CATALOG-STATE-V1",
    ownerDid,
    aggregateVersion,
    records: sortedMapValues(records),
  });
}

export const CounterfactualPracticeRunSchema = z.strictObject({
  practiceId: Sha256Schema,
  ownerDid: DidSchema,
  filmId: UuidV7Schema,
  gameId: UuidV7Schema,
  baseStateRoot: Sha256Schema,
  changedIntentCommitments: z
    .array(Sha256Schema)
    .min(1)
    .max(100)
    .refine((commitments) => new Set(commitments).size === commitments.length),
  counterfactualCommitment: Sha256Schema,
  requestedAt: IsoDateTimeSchema,
  recognizedGameMutation: z.literal(false),
});

export const PracticeRunPayloadSchema = z.strictObject({
  run: CounterfactualPracticeRunSchema,
});

export const DurablePracticeLessonSchema = z.strictObject({
  lessonId: UuidV7Schema,
  ownerDid: DidSchema,
  sourcePracticeId: Sha256Schema,
  lessonCommitment: Sha256Schema,
  authoredAt: IsoDateTimeSchema,
});

export const PracticeLessonPayloadSchema = z.strictObject({
  lesson: DurablePracticeLessonSchema,
});

export const PracticeInspectedPayloadSchema = z.strictObject({
  ownerDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-PRIVATE-PRACTICE-LEDGER-INSPECTION-V1"),
});

export type CounterfactualPracticeRun = z.infer<
  typeof CounterfactualPracticeRunSchema
>;
export type DurablePracticeLesson = z.infer<typeof DurablePracticeLessonSchema>;

export const PRIVATE_PRACTICE_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-private-practice-ledger",
  version: 1,
  aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
  eventTypes: [
    PRACTICE_RUN_EVENT_TYPE,
    PRACTICE_LESSON_EVENT_TYPE,
    PRACTICE_INSPECTED_EVENT_TYPE,
  ],
  contentMode: "commitments-only",
  recognizedGameMutation: false,
  durableLessonAuthority: "OWNER_ONLY",
});

function sortedMapValues<T>(values: ReadonlyMap<string, T>): T[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => structuredClone(value));
}

export function privatePracticeLedgerStateRoot(
  ownerDid: string,
  aggregateVersion: number,
  runs: ReadonlyMap<string, CounterfactualPracticeRun>,
  lessons: ReadonlyMap<string, DurablePracticeLesson>,
): Hex {
  return sha256Commitment({
    format: "ABL-PRIVATE-PRACTICE-LEDGER-STATE-V1",
    ownerDid,
    aggregateVersion,
    runs: sortedMapValues(runs),
    lessons: sortedMapValues(lessons),
    recognizedGameMutation: false,
  });
}

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

export function deriveCounterfactualPracticeRun(input: {
  film: CanonicalPrivateFilmRecord;
  baseStateRoot: `0x${string}`;
  changedIntentCommitments: readonly `0x${string}`[];
  requestedAt: string;
}): CounterfactualPracticeRun {
  const film = CanonicalPrivateFilmRecordSchema.parse(input.film);
  const lab = new PrivatePracticeLab();
  lab.admitFilm(
    {
      gameId: film.gameId,
      ownerDid: film.ownerDid,
      ciphertextCommitment: film.storage.ciphertextCommitment as Hex,
      eventRoot: film.eventRoot as Hex,
    },
    film.ownerDid,
  );
  const result = lab.counterfactual({
    ownerDid: film.ownerDid,
    gameId: film.gameId,
    baseStateRoot: input.baseStateRoot,
    changedIntentCommitments: input.changedIntentCommitments,
  });
  return CounterfactualPracticeRunSchema.parse({
    ...result,
    ownerDid: film.ownerDid,
    filmId: film.filmId,
    gameId: film.gameId,
    changedIntentCommitments: input.changedIntentCommitments,
    requestedAt: input.requestedAt,
  });
}
