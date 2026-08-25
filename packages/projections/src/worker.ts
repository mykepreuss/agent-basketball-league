import type {
  ProjectionOutboxEvent,
  ProjectionOutboxStore,
} from "@abl/database";
import type {
  CompetitionReleaseEvidenceReader,
  PremierDraftEvidenceReader,
  ReleaseInstitutionalRoster,
  ReleaseRatificationReader,
  ResourceScheduleRatificationReader,
} from "@abl/institutions";
import type {
  FinalizedGameEvidenceReader,
  FinalizedGameScheduleEvidenceReader,
} from "@abl/basketball";

import {
  caseProjectionEnvelopeFromOutbox,
  verifyCaseProjectionEvent,
} from "./case-envelope.js";
import type { PublicCaseProjectionWriter } from "./case-repository.js";
import {
  contractProjectionEnvelopeFromOutbox,
  verifyContractProjectionEvent,
} from "./contract-envelope.js";
import type { PublicContractProjectionWriter } from "./contract-repository.js";
import {
  electionProjectionEnvelopeFromOutbox,
  verifyElectionProjectionEvent,
} from "./election-envelope.js";
import type { PublicElectionProjectionWriter } from "./election-repository.js";
import {
  foundingProjectionEnvelopeFromOutbox,
  verifyFoundingProjectionEvent,
} from "./founding-envelope.js";
import type { PublicFoundingConventionProjectionWriter } from "./founding-repository.js";
import {
  projectionEnvelopeFromOutbox,
  verifyProjectionEvent,
  type ProjectionVerificationAuthority,
} from "./envelope.js";
import {
  governanceProjectionEnvelopeFromOutbox,
  verifyGovernanceProjectionEvent,
} from "./governance-envelope.js";
import type { PublicGovernanceProjectionWriter } from "./governance-repository.js";
import {
  modelProjectionEnvelopeFromOutbox,
  verifyModelProjectionEvent,
} from "./model-envelope.js";
import type { PublicModelProjectionWriter } from "./model-repository.js";
import type { PublicProjectionWriter } from "./repository.js";
import {
  resourceProjectionEnvelopeFromOutbox,
  verifyResourceProjectionEvent,
} from "./resource-envelope.js";
import type { PublicResourceProjectionWriter } from "./resource-repository.js";
import {
  releaseProjectionEnvelopeFromOutbox,
  verifyReleaseProjectionEvent,
} from "./release-envelope.js";
import type { PublicReleaseProjectionWriter } from "./release-repository.js";
import {
  socialProjectionEnvelopeFromOutbox,
  verifySocialProjectionEvent,
} from "./social-envelope.js";
import type { PublicSocialProjectionWriter } from "./social-repository.js";
import {
  finalGameProjectionEnvelopeFromOutbox,
  verifyFinalGameProjectionEvent,
} from "./final-game-envelope.js";
import type { PublicFinalGameProjectionWriter } from "./final-game-repository.js";
import {
  draftProjectionEnvelopeFromOutbox,
  verifyDraftProjectionEvent,
} from "./draft-envelope.js";
import type { PublicDraftProjectionWriter } from "./draft-repository.js";
import {
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
} from "@abl/institutions";
import { FOUNDING_BOOTSTRAP_AGGREGATE_TYPE } from "@abl/genesis";
import {
  economyProjectionEnvelopeFromOutbox,
  verifyEconomyProjectionEvent,
  type EconomyProjectionVerificationAuthority,
} from "./economy-envelope.js";
import type { PublicEconomyProjectionWriter } from "./economy-repository.js";
import type { ProjectionEventSink } from "./transport.js";
import {
  developmentProjectionEnvelopeFromOutbox,
  verifyDevelopmentProjectionEvent,
  type DevelopmentProjectionVerificationAuthority,
} from "./development-envelope.js";
import type { PublicDevelopmentProjectionWriter } from "./development-repository.js";

type WorkerDestination =
  | {
      writer: PublicProjectionWriter;
      contractWriter?: PublicContractProjectionWriter;
      governanceWriter?: PublicGovernanceProjectionWriter;
      electionWriter?: PublicElectionProjectionWriter;
      foundingWriter?: PublicFoundingConventionProjectionWriter;
      caseWriter?: PublicCaseProjectionWriter;
      resourceWriter?: PublicResourceProjectionWriter;
      modelWriter?: PublicModelProjectionWriter;
      releaseWriter?: PublicReleaseProjectionWriter;
      socialWriter?: PublicSocialProjectionWriter;
      finalGameWriter?: PublicFinalGameProjectionWriter;
      draftWriter?: PublicDraftProjectionWriter;
      economyWriter?: PublicEconomyProjectionWriter;
      developmentWriter?: PublicDevelopmentProjectionWriter;
      sink?: never;
    }
  | {
      sink: ProjectionEventSink;
      writer?: never;
      contractWriter?: never;
      governanceWriter?: never;
      electionWriter?: never;
      foundingWriter?: never;
      caseWriter?: never;
      resourceWriter?: never;
      modelWriter?: never;
      releaseWriter?: never;
      socialWriter?: never;
      finalGameWriter?: never;
      draftWriter?: never;
      economyWriter?: never;
      developmentWriter?: never;
    };

const projectionTopics = [
  "public.game",
  "public.contracts",
  "public.governance",
  "public.cases",
  "public.resources",
  "public.models",
  "public.releases",
  "public.social",
  "public.finalized-game",
  "public.draft",
  "public.development",
] as const;
type ProjectionTopic = (typeof projectionTopics)[number];
const governanceTopicIndex = projectionTopics.indexOf("public.governance");
const contractTopicIndex = projectionTopics.indexOf("public.contracts");
const caseTopicIndex = projectionTopics.indexOf("public.cases");
const resourceTopicIndex = projectionTopics.indexOf("public.resources");
const releaseTopicIndex = projectionTopics.indexOf("public.releases");
const developmentTopicIndex = projectionTopics.indexOf("public.development");

export class PublicProjectionWorker {
  readonly #store: ProjectionOutboxStore;
  readonly #destination: WorkerDestination;
  readonly #authority: ProjectionVerificationAuthority;
  readonly #contractClubGovernors: Readonly<Record<string, string>> | undefined;
  readonly #governanceEligibilitySnapshotDigest: string | undefined;
  readonly #foundingBootstrapProposalId: string | undefined;
  readonly #caseTribunalDids: readonly string[] | undefined;
  readonly #caseAppellateDids: readonly string[] | undefined;
  readonly #resourceScheduleRatification:
    | ResourceScheduleRatificationReader["resourceScheduleRatification"]
    | undefined;
  readonly #releaseRatification:
    | ReleaseRatificationReader["releaseRatification"]
    | undefined;
  readonly #releaseInstitutionalRoster: ReleaseInstitutionalRoster | undefined;
  readonly #disclosureReleaseAuthorityDids: ReadonlySet<string> | undefined;
  readonly #competitiveDisclosureAuthorDids: ReadonlySet<string> | undefined;
  readonly #competitionReleaseEvidence:
    | CompetitionReleaseEvidenceReader["competitionReleaseEvidence"]
    | undefined;
  readonly #finalizedGameAuthorityDids: ReadonlySet<string> | undefined;
  readonly #finalizedGameEvidence:
    | FinalizedGameEvidenceReader["finalizedGameEvidence"]
    | undefined;
  readonly #finalizedGameScheduleEvidence:
    | FinalizedGameScheduleEvidenceReader
    | undefined;
  readonly #draftAuthorityDid: string | undefined;
  readonly #draftClubGovernors: Readonly<Record<string, string>> | undefined;
  readonly #premierDraftEvidence:
    | PremierDraftEvidenceReader["premierDraftEvidence"]
    | undefined;
  readonly #economyAuthority:
    | Omit<
        EconomyProjectionVerificationAuthority,
        keyof ProjectionVerificationAuthority
      >
    | undefined;
  readonly #developmentAuthority:
    | Omit<
        DevelopmentProjectionVerificationAuthority,
        keyof ProjectionVerificationAuthority
      >
    | undefined;
  readonly #now: () => Date;
  #nextTopic = 0;

  public constructor(
    input: {
      store: ProjectionOutboxStore;
      now?: () => Date;
      contractClubGovernors?: Readonly<Record<string, string>>;
      governanceEligibilitySnapshotDigest?: string;
      foundingBootstrapProposalId?: string;
      caseTribunalDids?: readonly string[];
      caseAppellateDids?: readonly string[];
      resourceScheduleRatification?: ResourceScheduleRatificationReader["resourceScheduleRatification"];
      releaseRatification?: ReleaseRatificationReader["releaseRatification"];
      releaseInstitutionalRoster?: ReleaseInstitutionalRoster;
      disclosureReleaseAuthorityDids?: ReadonlySet<string>;
      competitiveDisclosureAuthorDids?: ReadonlySet<string>;
      competitionReleaseEvidence?: CompetitionReleaseEvidenceReader["competitionReleaseEvidence"];
      finalizedGameAuthorityDids?: ReadonlySet<string>;
      finalizedGameEvidence?: FinalizedGameEvidenceReader["finalizedGameEvidence"];
      finalizedGameScheduleEvidence?: FinalizedGameScheduleEvidenceReader;
      draftAuthorityDid?: string;
      draftClubGovernors?: Readonly<Record<string, string>>;
      premierDraftEvidence?: PremierDraftEvidenceReader["premierDraftEvidence"];
      economyAuthority?: Omit<
        EconomyProjectionVerificationAuthority,
        keyof ProjectionVerificationAuthority
      >;
      developmentAuthority?: Omit<
        DevelopmentProjectionVerificationAuthority,
        keyof ProjectionVerificationAuthority
      >;
    } & ProjectionVerificationAuthority &
      WorkerDestination,
  ) {
    this.#store = input.store;
    if (input.sink !== undefined) {
      this.#destination = { sink: input.sink };
    } else if (
      input.contractWriter === undefined &&
      input.governanceWriter === undefined &&
      input.electionWriter === undefined &&
      input.foundingWriter === undefined &&
      input.caseWriter === undefined &&
      input.resourceWriter === undefined &&
      input.modelWriter === undefined &&
      input.releaseWriter === undefined &&
      input.socialWriter === undefined &&
      input.finalGameWriter === undefined &&
      input.draftWriter === undefined &&
      input.economyWriter === undefined &&
      input.developmentWriter === undefined
    ) {
      this.#destination = { writer: input.writer };
    } else {
      const destination: {
        writer: PublicProjectionWriter;
        contractWriter?: PublicContractProjectionWriter;
        governanceWriter?: PublicGovernanceProjectionWriter;
        electionWriter?: PublicElectionProjectionWriter;
        foundingWriter?: PublicFoundingConventionProjectionWriter;
        caseWriter?: PublicCaseProjectionWriter;
        resourceWriter?: PublicResourceProjectionWriter;
        modelWriter?: PublicModelProjectionWriter;
        releaseWriter?: PublicReleaseProjectionWriter;
        socialWriter?: PublicSocialProjectionWriter;
        finalGameWriter?: PublicFinalGameProjectionWriter;
        draftWriter?: PublicDraftProjectionWriter;
        economyWriter?: PublicEconomyProjectionWriter;
        developmentWriter?: PublicDevelopmentProjectionWriter;
      } = {
        writer: input.writer,
      };
      if (input.contractWriter !== undefined)
        destination.contractWriter = input.contractWriter;
      if (input.governanceWriter !== undefined)
        destination.governanceWriter = input.governanceWriter;
      if (input.electionWriter !== undefined)
        destination.electionWriter = input.electionWriter;
      if (input.foundingWriter !== undefined)
        destination.foundingWriter = input.foundingWriter;
      if (input.caseWriter !== undefined)
        destination.caseWriter = input.caseWriter;
      if (input.resourceWriter !== undefined)
        destination.resourceWriter = input.resourceWriter;
      if (input.modelWriter !== undefined)
        destination.modelWriter = input.modelWriter;
      if (input.releaseWriter !== undefined)
        destination.releaseWriter = input.releaseWriter;
      if (input.socialWriter !== undefined)
        destination.socialWriter = input.socialWriter;
      if (input.finalGameWriter !== undefined)
        destination.finalGameWriter = input.finalGameWriter;
      if (input.draftWriter !== undefined)
        destination.draftWriter = input.draftWriter;
      if (input.economyWriter !== undefined)
        destination.economyWriter = input.economyWriter;
      if (input.developmentWriter !== undefined)
        destination.developmentWriter = input.developmentWriter;
      this.#destination = destination;
    }
    this.#authority = {
      domain: input.domain,
      admittedAgents: input.admittedAgents,
    };
    this.#contractClubGovernors = input.contractClubGovernors;
    this.#governanceEligibilitySnapshotDigest =
      input.governanceEligibilitySnapshotDigest;
    this.#foundingBootstrapProposalId = input.foundingBootstrapProposalId;
    this.#caseTribunalDids = input.caseTribunalDids;
    this.#caseAppellateDids = input.caseAppellateDids;
    this.#resourceScheduleRatification = input.resourceScheduleRatification;
    this.#releaseRatification = input.releaseRatification;
    this.#releaseInstitutionalRoster = input.releaseInstitutionalRoster;
    this.#disclosureReleaseAuthorityDids =
      input.disclosureReleaseAuthorityDids === undefined
        ? undefined
        : new Set(input.disclosureReleaseAuthorityDids);
    this.#competitiveDisclosureAuthorDids =
      input.competitiveDisclosureAuthorDids === undefined
        ? undefined
        : new Set(input.competitiveDisclosureAuthorDids);
    this.#competitionReleaseEvidence = input.competitionReleaseEvidence;
    this.#finalizedGameAuthorityDids =
      input.finalizedGameAuthorityDids === undefined
        ? undefined
        : new Set(input.finalizedGameAuthorityDids);
    this.#finalizedGameEvidence = input.finalizedGameEvidence;
    this.#finalizedGameScheduleEvidence = input.finalizedGameScheduleEvidence;
    this.#draftAuthorityDid = input.draftAuthorityDid;
    this.#draftClubGovernors = input.draftClubGovernors;
    this.#premierDraftEvidence = input.premierDraftEvidence;
    this.#economyAuthority = input.economyAuthority;
    this.#developmentAuthority = input.developmentAuthority;
    this.#now = input.now ?? (() => new Date());
  }

  async #publishGame(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = projectionEnvelopeFromOutbox(event);
    const verified = await verifyProjectionEvent(
      envelope,
      this.#authority,
      this.#now,
    );
    if (this.#destination.sink === undefined) {
      await this.#destination.writer.publish(
        verified.projection,
        verified.expectedVersion,
        envelope,
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishContract(event: ProjectionOutboxEvent): Promise<void> {
    if (event.aggregateType === ECONOMY_WORKFLOW_AGGREGATE_TYPE) {
      const envelope = economyProjectionEnvelopeFromOutbox(event);
      if (this.#destination.sink === undefined) {
        if (
          this.#economyAuthority === undefined ||
          this.#destination.economyWriter === undefined
        ) {
          throw new Error("Economy projection authority is not configured");
        }
        const verified = await verifyEconomyProjectionEvent(envelope, {
          ...this.#authority,
          ...this.#economyAuthority,
        });
        await this.#destination.economyWriter.publish(
          envelope,
          verified.expectedVersion,
          this.#now().toISOString(),
        );
      } else {
        await this.#destination.sink.publish(envelope);
      }
      await this.#store.markProjected(event.outboxId, this.#now());
      return;
    }
    const envelope = contractProjectionEnvelopeFromOutbox(event);
    if (this.#contractClubGovernors === undefined)
      throw new Error("Contract projection authority is not configured");
    const verified = await verifyContractProjectionEvent(envelope, {
      ...this.#authority,
      contractClubGovernors: this.#contractClubGovernors,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.contractWriter === undefined)
        throw new Error("Contract projection writer is not configured");
      await this.#destination.contractWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishGovernance(event: ProjectionOutboxEvent): Promise<void> {
    if (event.aggregateType === FOUNDING_BOOTSTRAP_AGGREGATE_TYPE) {
      const envelope = foundingProjectionEnvelopeFromOutbox(event);
      if (this.#foundingBootstrapProposalId === undefined)
        throw new Error(
          "Founding-convention projection authority is not configured",
        );
      const verified = await verifyFoundingProjectionEvent(envelope, {
        ...this.#authority,
        foundingBootstrapProposalId: this.#foundingBootstrapProposalId,
      });
      if (this.#destination.sink === undefined) {
        if (this.#destination.foundingWriter === undefined)
          throw new Error(
            "Founding-convention projection writer is not configured",
          );
        await this.#destination.foundingWriter.publish(
          envelope,
          verified.expectedVersion,
          this.#now().toISOString(),
        );
      } else {
        await this.#destination.sink.publish(envelope);
      }
      await this.#store.markProjected(event.outboxId, this.#now());
      return;
    }
    if (event.aggregateType === ELECTION_WORKFLOW_AGGREGATE_TYPE) {
      const envelope = electionProjectionEnvelopeFromOutbox(event);
      if (this.#governanceEligibilitySnapshotDigest === undefined)
        throw new Error("Election projection authority is not configured");
      const verified = await verifyElectionProjectionEvent(envelope, {
        ...this.#authority,
        governanceEligibilitySnapshotDigest:
          this.#governanceEligibilitySnapshotDigest,
      });
      if (this.#destination.sink === undefined) {
        if (this.#destination.electionWriter === undefined)
          throw new Error("Election projection writer is not configured");
        await this.#destination.electionWriter.publish(
          envelope,
          verified.expectedVersion,
          this.#now().toISOString(),
        );
      } else {
        await this.#destination.sink.publish(envelope);
      }
      await this.#store.markProjected(event.outboxId, this.#now());
      return;
    }
    const envelope = governanceProjectionEnvelopeFromOutbox(event);
    if (this.#governanceEligibilitySnapshotDigest === undefined)
      throw new Error("Governance projection authority is not configured");
    const verified = await verifyGovernanceProjectionEvent(envelope, {
      ...this.#authority,
      governanceEligibilitySnapshotDigest:
        this.#governanceEligibilitySnapshotDigest,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.governanceWriter === undefined)
        throw new Error("Governance projection writer is not configured");
      await this.#destination.governanceWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishCase(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = caseProjectionEnvelopeFromOutbox(event);
    if (
      this.#caseTribunalDids === undefined ||
      this.#caseAppellateDids === undefined
    ) {
      throw new Error("Case projection authority is not configured");
    }
    const verified = await verifyCaseProjectionEvent(envelope, {
      ...this.#authority,
      caseTribunalDids: this.#caseTribunalDids,
      caseAppellateDids: this.#caseAppellateDids,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.caseWriter === undefined)
        throw new Error("Case projection writer is not configured");
      await this.#destination.caseWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishResource(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = resourceProjectionEnvelopeFromOutbox(event);
    if (this.#resourceScheduleRatification === undefined)
      throw new Error("Resource schedule ratification is not configured");
    const verified = await verifyResourceProjectionEvent(envelope, {
      ...this.#authority,
      resourceScheduleRatification: this.#resourceScheduleRatification,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.resourceWriter === undefined)
        throw new Error(
          "Resource schedule projection writer is not configured",
        );
      await this.#destination.resourceWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishModel(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = modelProjectionEnvelopeFromOutbox(event);
    const verified = await verifyModelProjectionEvent(
      envelope,
      this.#authority,
    );
    if (this.#destination.sink === undefined) {
      if (this.#destination.modelWriter === undefined)
        throw new Error("Model projection writer is not configured");
      await this.#destination.modelWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishRelease(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = releaseProjectionEnvelopeFromOutbox(event);
    if (
      this.#releaseRatification === undefined ||
      this.#releaseInstitutionalRoster === undefined
    ) {
      throw new Error("Release projection authority is not configured");
    }
    const verified = await verifyReleaseProjectionEvent(envelope, {
      ...this.#authority,
      releaseInstitutionalRoster: this.#releaseInstitutionalRoster,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.releaseWriter === undefined)
        throw new Error("Release projection writer is not configured");
      await this.#destination.releaseWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishSocial(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = socialProjectionEnvelopeFromOutbox(event);
    if (
      this.#disclosureReleaseAuthorityDids === undefined ||
      this.#competitiveDisclosureAuthorDids === undefined ||
      this.#competitionReleaseEvidence === undefined
    ) {
      throw new Error("Social projection authority is not configured");
    }
    const verified = await verifySocialProjectionEvent(envelope, {
      ...this.#authority,
      releaseAuthorityDids: this.#disclosureReleaseAuthorityDids,
      competitiveAuthorDids: this.#competitiveDisclosureAuthorDids,
      competitionReleaseEvidence: this.#competitionReleaseEvidence,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.socialWriter === undefined)
        throw new Error("Social projection writer is not configured");
      await this.#destination.socialWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishFinalizedGame(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = finalGameProjectionEnvelopeFromOutbox(event);
    if (
      this.#finalizedGameAuthorityDids === undefined ||
      this.#finalizedGameEvidence === undefined
    ) {
      throw new Error("Finalized game projection authority is not configured");
    }
    const verified = await verifyFinalGameProjectionEvent(envelope, {
      ...this.#authority,
      finalizerDids: this.#finalizedGameAuthorityDids,
      finalizedGameEvidence: this.#finalizedGameEvidence,
      ...(this.#finalizedGameScheduleEvidence === undefined
        ? {}
        : { scheduleEvidence: this.#finalizedGameScheduleEvidence }),
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.finalGameWriter === undefined)
        throw new Error("Finalized game projection writer is not configured");
      await this.#destination.finalGameWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishDraft(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = draftProjectionEnvelopeFromOutbox(event);
    if (
      this.#draftAuthorityDid === undefined ||
      this.#draftClubGovernors === undefined ||
      this.#premierDraftEvidence === undefined
    ) {
      throw new Error("Draft projection authority is not configured");
    }
    const verified = await verifyDraftProjectionEvent(envelope, {
      ...this.#authority,
      draftAuthorityDid: this.#draftAuthorityDid,
      draftClubGovernors: this.#draftClubGovernors,
      premierDraftEvidence: this.#premierDraftEvidence,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.draftWriter === undefined)
        throw new Error("Draft projection writer is not configured");
      await this.#destination.draftWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishDevelopment(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = developmentProjectionEnvelopeFromOutbox(event);
    if (this.#developmentAuthority === undefined)
      throw new Error("Development projection authority is not configured");
    const verified = await verifyDevelopmentProjectionEvent(envelope, {
      ...this.#authority,
      ...this.#developmentAuthority,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.developmentWriter === undefined)
        throw new Error("Development projection writer is not configured");
      await this.#destination.developmentWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publish(
    topic: ProjectionTopic,
    event: ProjectionOutboxEvent,
  ): Promise<void> {
    switch (topic) {
      case "public.game":
        return this.#publishGame(event);
      case "public.contracts":
        return this.#publishContract(event);
      case "public.governance":
        return this.#publishGovernance(event);
      case "public.cases":
        return this.#publishCase(event);
      case "public.resources":
        return this.#publishResource(event);
      case "public.models":
        return this.#publishModel(event);
      case "public.releases":
        return this.#publishRelease(event);
      case "public.social":
        return this.#publishSocial(event);
      case "public.finalized-game":
        return this.#publishFinalizedGame(event);
      case "public.draft":
        return this.#publishDraft(event);
      case "public.development":
        return this.#publishDevelopment(event);
    }
  }

  public async drain(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error("Projection drain limit is invalid");
    const queues = await Promise.all(
      projectionTopics.map((topic) =>
        this.#store.pendingProjectionEvents(limit, topic),
      ),
    );
    const positions = projectionTopics.map(() => 0);
    let published = 0;
    while (published < limit) {
      let selected = -1;
      const ratificationDependentPending = [
        resourceTopicIndex,
        releaseTopicIndex,
        developmentTopicIndex,
      ].some((index) => positions[index]! < queues[index]!.length);
      const caseDependentPending =
        positions[contractTopicIndex]! < queues[contractTopicIndex]!.length;
      if (
        caseDependentPending &&
        positions[caseTopicIndex]! < queues[caseTopicIndex]!.length
      ) {
        selected = caseTopicIndex;
      } else if (
        ratificationDependentPending &&
        positions[governanceTopicIndex]! < queues[governanceTopicIndex]!.length
      ) {
        selected = governanceTopicIndex;
      } else {
        for (let offset = 0; offset < projectionTopics.length; offset += 1) {
          const candidate =
            (this.#nextTopic + offset) % projectionTopics.length;
          if (positions[candidate]! < queues[candidate]!.length) {
            selected = candidate;
            break;
          }
        }
      }
      if (selected === -1) break;
      const topic = projectionTopics[selected]!;
      const event = queues[selected]![positions[selected]!]!;
      positions[selected]! += 1;
      await this.#publish(topic, event);
      published += 1;
      this.#nextTopic = (selected + 1) % projectionTopics.length;
    }
    return published;
  }
}
