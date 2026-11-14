import { it, expect, vi } from "vitest";
const calls = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api: calls.api }));
import { prepareVoiceOnDemand } from "./voicePreparation";
it("shares reader demand and retries failed preparation", async () => {
  let release!: () => void;
  calls.api.mockImplementationOnce(
    () => new Promise<void>((r) => (release = r)),
  );
  const a = prepareVoiceOnDemand("voice-a"),
    b = prepareVoiceOnDemand("voice-a");
  expect(a).toBe(b);
  expect(calls.api).toHaveBeenCalledTimes(1);
  release();
  await a;
  calls.api.mockRejectedValueOnce(Error("failed"));
  await expect(prepareVoiceOnDemand("voice-b")).rejects.toThrow();
  calls.api.mockResolvedValueOnce({});
  await prepareVoiceOnDemand("voice-b");
  expect(calls.api).toHaveBeenCalledTimes(3);
});
