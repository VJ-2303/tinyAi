import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  pruneChatHistory,
  extractModelReply,
  queryVLLM,
  streamVLLM,
  ChatMessage,
} from "../src/lib/llm";

describe("LLM Module & Response Parser (src/lib/llm.ts)", () => {
  describe("1. Token Estimation (estimateTokens)", () => {
    it("returns 0 for empty or falsy text", () => {
      assert.equal(estimateTokens(""), 0);
      assert.equal(estimateTokens(null as unknown as string), 0);
      assert.equal(estimateTokens(undefined as unknown as string), 0);
    });

    it("accurately estimates English text and punctuation", () => {
      // "Hello, world! This is a test." is 9 tokens in BPE (cl100k/o200k)
      const count = estimateTokens("Hello, world! This is a test.");
      assert.ok(count >= 7 && count <= 10);
    });

    it("accurately estimates code tokens (braces, symbols, keywords)", () => {
      const code = "function updatePlayer(player, dt) { if (player.x > 100) return; }";
      const count = estimateTokens(code);
      assert.ok(count >= 18 && count <= 23);
    });

    it("accurately handles multibyte characters (emojis, CJK)", () => {
      const emojiCount = estimateTokens("🚀🤖🔥");
      assert.ok(emojiCount >= 3 && emojiCount <= 6);

      const cjkCount = estimateTokens("你好世界");
      assert.ok(cjkCount >= 3 && cjkCount <= 6);
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

    it("prunes down to 50% of token budget when context gets full", () => {
      // 10 messages of ~48 tokens each = ~480 tokens
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Message ${i + 1} with repeated test content words for token length. `.repeat(4),
      }));

      // Set contextWindow such that total tokens (~480) exceeds availableBudget (~292)
      // availableBudget = Math.max(200, 500 - 100 - systemTokens(~8) - safetyBuffer(100)) = ~292 tokens
      const pruned = pruneChatHistory(systemPrompt, history, 500, 100);

      // System prompt always at index 0
      assert.equal(pruned[0].role, "system");
      assert.equal(pruned[0].content, systemPrompt);

      // Should have pruned older messages
      assert.ok(pruned.length < history.length + 1);

      // Newest message must be preserved
      assert.equal(pruned[pruned.length - 1].content, history[history.length - 1].content);

      // Pruned history messages (excluding system) must consume <= 50% of availableBudget (~146 tokens)
      const keptHistory = pruned.slice(1);
      const keptTokens = keptHistory.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
      const availableBudget = Math.max(200, 500 - 100 - estimateTokens(systemPrompt) - 100);
      assert.ok(keptTokens <= Math.floor(availableBudget * 0.5));
    });

    it("preserves newest message even if it alone exceeds 50% target budget", () => {
      const history = [
        { role: "user" as const, content: "Old message 1 ".repeat(40) }, // ~120 tokens
        { role: "user" as const, content: "Huge latest prompt ".repeat(35) }, // ~105 tokens
      ];
      // availableBudget = 200, 50% budget = 100. Total tokens ~233 > 200 (full!).
      // Latest message is ~109 tokens > 100 (50% target budget).
      const pruned = pruneChatHistory(systemPrompt, history, 350, 100);
      assert.equal(pruned[0].role, "system");
      assert.equal(pruned.length, 2); // system + latest message
      assert.equal(pruned[1].content, history[1].content);
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

  describe("5. Streaming streamVLLM (Final Response Only)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("streams final response tokens while filtering out reasoning tokens", async () => {
      // Mock SSE response with reasoning chunks first, then content chunks
      const sseChunks = [
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"Let me "}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"think about it."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"function "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"jump() "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"{}"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          body: mockStream,
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const receivedTokens: string[] = [];
      for await (const token of streamVLLM([{ role: "user", content: "Make jump" }])) {
        receivedTokens.push(token);
      }

      // Must NOT contain reasoning tokens
      assert.ok(!receivedTokens.some((t) => t.includes("think")));
      assert.ok(!receivedTokens.some((t) => t.includes("Let me")));

      // Must contain final response tokens
      assert.deepEqual(receivedTokens, ["function ", "jump() ", "{}"]);
    });

    it("falls back to reasoning tokens if content was completely empty", async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"reasoning_content":"Reasoning only fallback"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          body: mockStream,
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const receivedTokens: string[] = [];
      for await (const token of streamVLLM([{ role: "user", content: "Help" }])) {
        receivedTokens.push(token);
      }

      assert.deepEqual(receivedTokens, ["Reasoning only fallback"]);
    });

    it("yields offline fallback message on network error during streaming", async () => {
      globalThis.fetch = (async () => {
        throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:8000");
      }) as unknown as typeof fetch;

      const receivedTokens: string[] = [];
      for await (const token of streamVLLM([{ role: "user", content: "Offline test" }])) {
        receivedTokens.push(token);
      }

      const fullOutput = receivedTokens.join("");
      assert.match(fullOutput, /vLLM Offline Mode/);
      assert.match(fullOutput, /Offline test/);
    });
  });
});
