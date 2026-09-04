import { describe, expect, it } from "vitest";
import { harnessChatRpcContract } from "../src/server.js";

describe("harness-chat rpc contract", () => {
  it("declares createSession/sendPrompt/history", () => {
    expect(harnessChatRpcContract).toHaveProperty("createSession");
    expect(harnessChatRpcContract).toHaveProperty("sendPrompt");
    expect(harnessChatRpcContract).toHaveProperty("history");
  });
});
