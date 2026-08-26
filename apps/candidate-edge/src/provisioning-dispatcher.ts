import { blJob } from "@blaxel/core";
import { z } from "zod";

export interface CandidateProvisioningDispatcher {
  dispatch(applicationId: string): Promise<"DISPATCHED" | "ALREADY_DISPATCHED">;
}

export class BlaxelJobCandidateProvisioningDispatcher
  implements CandidateProvisioningDispatcher
{
  readonly #jobName: string;
  readonly #dispatched = new Set<string>();
  readonly #pending = new Map<string, Promise<void>>();

  constructor(jobName: string) {
    this.#jobName = z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
      .parse(jobName);
  }

  async dispatch(
    applicationId: string,
  ): Promise<"DISPATCHED" | "ALREADY_DISPATCHED"> {
    const id = z.uuid().parse(applicationId);
    if (this.#dispatched.has(id)) return "ALREADY_DISPATCHED";
    let pending = this.#pending.get(id);
    const startsDispatch = pending === undefined;
    if (pending === undefined) {
      pending = blJob(this.#jobName)
        .run([{ applicationId: id, action: "PROVISION" }], {
          allowQueue: false,
        })
        .then(() => undefined);
      this.#pending.set(id, pending);
    }
    try {
      await pending;
    } finally {
      if (this.#pending.get(id) === pending) this.#pending.delete(id);
    }
    if (startsDispatch) {
      this.#dispatched.add(id);
      return "DISPATCHED";
    }
    return "ALREADY_DISPATCHED";
  }
}
