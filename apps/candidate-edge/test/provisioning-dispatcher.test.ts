import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();

vi.mock("@blaxel/core", () => ({
  blJob: vi.fn(() => ({ run })),
}));

import { BlaxelJobCandidateProvisioningDispatcher } from "../src/provisioning-dispatcher.js";

describe("candidate provisioning dispatch", () => {
  beforeEach(() => run.mockReset());

  it("coalesces concurrent status retries into one deterministic Job run", async () => {
    let complete!: () => void;
    run.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    const applicationId = "0198e000-0000-7000-8000-000000000041";
    const dispatcher = new BlaxelJobCandidateProvisioningDispatcher(
      "abl-candidate-provisioner",
    );
    const first = dispatcher.dispatch(applicationId);
    const second = dispatcher.dispatch(applicationId);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    complete();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "DISPATCHED",
      "ALREADY_DISPATCHED",
    ]);
    await expect(dispatcher.dispatch(applicationId)).resolves.toBe(
      "ALREADY_DISPATCHED",
    );
    expect(run).toHaveBeenCalledWith([{ applicationId, action: "PROVISION" }], {
      allowQueue: true,
      executionId: "candidate-0198e000000070008000000000000041",
    });
  });

  it("allows a later signed-status retry after a provider dispatch failure", async () => {
    run.mockRejectedValueOnce(new Error("provider unavailable"));
    run.mockResolvedValueOnce(undefined);
    const dispatcher = new BlaxelJobCandidateProvisioningDispatcher(
      "abl-candidate-provisioner",
    );
    const applicationId = "0198e000-0000-7000-8000-000000000042";
    await expect(dispatcher.dispatch(applicationId)).rejects.toThrow(
      "provider unavailable",
    );
    await expect(dispatcher.dispatch(applicationId)).resolves.toBe(
      "DISPATCHED",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });
});
