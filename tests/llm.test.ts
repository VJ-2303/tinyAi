import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  pruneChatHistory,
  extractModelReply,
  queryVLLM,
  ChatMessage,
} from "../src/lib/llm";

describe("LLM Module & Response Parser (src/lib/llm.ts)", () => {
  describe("1. Token Estimation (estimateTokens)", () => {
    it("returns 0 for empty or falsy text", () => {
      assert.equal(estimateTokens(""), 0);
      assert.equal(estimateTokens(null as unknown as string), 0);
    });

    it("estimates tokens at roughly 4 chars per token ceiling", () => {
      assert.equal(estimateTokens("abcd"), 1);
      assert.equal(estimateTokens("abcde"), 2);
      assert.equal(estimateTokens("Hello, world! This is a test."), 8);
    });
  });

  describe("2. Context Pruning (pruneChatHistory)", () => {
    const systemPrompt = "You are a coding mentor.";

    it("always keeps the system prompt even with empty history", () => {
      const pruned = pruneChatHistory(systemPrompt, []);
      assert.equal(pruned.length, 1);
      assert.equal(pruned[0].role, "system");
      assert.equal(pruned[0].content, systemPrompt);
    });

    it("retains all messages if total tokens fit within available budget", () => {
      const history = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
        { role: "user" as const, content: "Help me with canvas" },
      ];
      const pruned = pruneChatHistory(systemPrompt, history, 4096, 1024);
      assert.equal(pruned.length, 4); // system + 3 history messages
      assert.equal(pruned[0].role, "system");
      assert.equal(pruned[1].content, "Hello");
      assert.equal(pruned[3].content, "Help me with canvas");
    });

    it("prunes oldest messages first (FIFO) when context window is exceeded", () => {
      const history = [
        { role: "user" as const, content: "Old message 1 ".repeat(40) }, // ~160 tokens
        { role: "assistant" as const, content: "Old message 2 ".repeat(40) }, // ~160 tokens
        { role: "user" as const, content: "New message 3" }, // ~4 tokens
      ];
      // Set a tiny context window where budget allows only system + latest message
      const pruned = pruneChatHistory(systemPrompt, history, 350, 100);
      assert.ok(pruned.length < 4);
      assert.equal(pruned[0].role, "system");
      // The newest message must be preserved
      assert.equal(pruned[pruned.length - 1].content, "New message 3");
    });
  });

  describe("3. Model Reply Extraction (extractModelReply)", () => {
    it("returns empty string for null, undefined, or empty message", () => {
      assert.equal(extractModelReply(null), "");
      assert.equal(extractModelReply(undefined), "");
      assert.equal(extractModelReply({}), "");
    });

    it("extracts standard final answer from content", () => {
      const msg = {
        content: "const canvas = document.getElementById('game');",
      };
      assert.equal(extractModelReply(msg), "const canvas = document.getElementById('game');");
    });

    it("extracts reasoning_content when content is null or empty", () => {
      // Common when model runs out of max_tokens mid-thought or LiteLLM outputs thinking only
      const msg1 = {
        content: "",
        reasoning_content: "Step 1: Check collision coordinates.",
      };
      assert.equal(extractModelReply(msg1), "Step 1: Check collision coordinates.");

      const msg2 = {
        content: null,
        reasoning_content: "Step 2: Update paddle velocity.",
      };
      assert.equal(extractModelReply(msg2), "Step 2: Update paddle velocity.");
    });

    it("falls back to reasoning field if reasoning_content is absent", () => {
      const msg = {
        content: "  ",
        reasoning: "Analysis: ball radius should be 10.",
      };
      assert.equal(extractModelReply(msg), "Analysis: ball radius should be 10.");
    });

    it("prefers final synthesized content when both content and reasoning_content exist", () => {
      const msg = {
        content: "Final Game Loop Code",
        reasoning_content: "Internal thought process...",
      };
      assert.equal(extractModelReply(msg), "Final Game Loop Code");
    });

    it("strips raw <think>...</think> tags when answer follows", () => {
      const msg = {
        content: "<think>\nEvaluate collision\nCalculate vector\n</think>\n\nfunction update() { ball.x += dx; }",
      };
      assert.equal(extractModelReply(msg), "function update() { ball.x += dx; }");
    });

    it("unwraps <think> tags if message ONLY contains thinking block", () => {
      const msg = {
        content: "<think>I am solving the quadratic formula for gravity</think>",
      };
      assert.equal(extractModelReply(msg), "I am solving the quadratic formula for gravity");
    });
  });

  describe("4. End-to-End queryVLLM with Mocked Fetch", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("parses standard assistant completion response", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "function movePlayer() { player.x += 5; }",
                },
              },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const reply = await queryVLLM([{ role: "user", content: "Move player" }]);
      assert.equal(reply, "function movePlayer() { player.x += 5; }");
    });

    it("parses reasoning model completion response (reasoning_content fallback)", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  reasoning_content: "Thinking: Player movement should be clamped to screen boundaries.",
                },
              },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const reply = await queryVLLM([{ role: "user", content: "Move player" }]);
      assert.equal(reply, "Thinking: Player movement should be clamped to screen boundaries.");
    });

    it("strips inline <think> tags from completion response", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "<think>Need to check x bounds</think>player.x = Math.max(0, player.x);",
                },
              },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const reply = await queryVLLM([{ role: "user", content: "Boundary check" }]);
      assert.equal(reply, "player.x = Math.max(0, player.x);");
    });

    it("throws error when response status is non-ok", async () => {
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 500,
          text: async () => "Internal GPU failure",
        } as Response;
      }) as unknown as typeof fetch;

      await assert.rejects(
        () => queryVLLM([{ role: "user", content: "Crash test" }]),
        /vLLM server responded with 500/
      );
    });

    it("provides informative offline fallback message on connection error", async () => {
      globalThis.fetch = (async () => {
        throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:8000");
      }) as unknown as typeof fetch;

      const reply = await queryVLLM([{ role: "user", content: "How do I make a sprite?" }]);
      assert.match(reply, /vLLM Offline Mode/);
      assert.match(reply, /How do I make a sprite\?/);
    });
  });
});
