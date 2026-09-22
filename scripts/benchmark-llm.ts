#!/usr/bin/env node
/**
 * LLM Load & Performance Benchmark Tool
 *
 * Tests OpenAI-compatible endpoints (vLLM, Ollama, OpenAI, Groq, etc.)
 * under concurrent streaming load to measure:
 * - Time to First Token (TTFT)
 * - Inter-Token Latency (ITL)
 * - Generation Speed (Tokens / Second)
 * - End-to-End Latency
 * - Total Cluster Throughput
 */

import { performance } from "node:perf_hooks";
import fs from "node:fs";

// Automatically load .env.local if present
try {
  if (fs.existsSync(".env.local")) {
    (process as any).loadEnvFile?.(".env.local");
  }
} catch {
  // Ignore if unsupported or already loaded
}

interface BenchmarkOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  totalRequests: number;
  maxTokens: number;
  temperature: number;
  prompt: string;
  timeoutMs: number;
}

interface RequestResult {
  id: number;
  success: boolean;
  statusCode: number;
  ttftMs: number;
  totalDurationMs: number;
  genDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSec: number;
  interTokenLatencyMs: number;
  error?: string;
}

// ----------------------------------------------------------------------------
// Argument Parsing
// ----------------------------------------------------------------------------
function parseArgs(): BenchmarkOptions {
  const args = process.argv.slice(2);
  const getArg = (names: string[], def: string): string => {
    for (let i = 0; i < args.length; i++) {
      if (names.includes(args[i]) && args[i + 1]) {
        return args[i + 1];
      }
      for (const name of names) {
        if (args[i].startsWith(`${name}=`)) {
          return args[i].split("=")[1];
        }
      }
    }
    return def;
  };

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  npx tsx scripts/benchmark-llm.ts [options]

Options:
  --url, -u        API Base URL (default: $API_BASE_URL or http://localhost:8000/v1)
  --model, -m      Model identifier (default: $MODEL_ID or Qwen/Qwen2.5-Coder-0.5B-Instruct)
  --key, -k        API Key (default: $API_KEY or dummy-key)
  --concurrency, -c Number of concurrent requests (default: 10)
  --requests, -n   Total requests to run (default: 20)
  --max-tokens     Max tokens to generate (default: 256)
  --prompt, -p     Custom prompt to send (default: code generation prompt)
  --timeout        Request timeout in ms (default: 60000)

Examples:
  npx tsx scripts/benchmark-llm.ts --url https://api.openai.com/v1 --model gpt-4o-mini --key sk-... --concurrency 10
  npx tsx scripts/benchmark-llm.ts --url http://192.168.1.50:8000/v1 --model meta-llama/Llama-3-8B-Instruct --concurrency 10 -n 30
`);
    process.exit(0);
  }

  const baseUrl = getArg(
    ["--url", "-u"],
    process.env.API_BASE_URL || process.env.VLLM_BASE_URL || "http://localhost:8000/v1"
  );
  const model = getArg(
    ["--model", "-m"],
    process.env.MODEL_ID || process.env.VLLM_MODEL || "Qwen/Qwen2.5-Coder-0.5B-Instruct"
  );
  const apiKey = getArg(["--key", "-k"], process.env.API_KEY || process.env.VLLM_API_KEY || "dummy-key");
  const concurrency = parseInt(getArg(["--concurrency", "-c", "--c"], "10"), 10);
  const totalRequests = parseInt(getArg(["--requests", "-n", "--n"], "20"), 10);
  const maxTokens = parseInt(getArg(["--max-tokens", "-m-tok"], "256"), 10);
  const timeoutMs = parseInt(getArg(["--timeout"], "60000"), 10);
  const prompt = getArg(
    ["--prompt", "-p"],
    "Write a JavaScript function that implements an A* pathfinding algorithm on a 2D grid with obstacles. Include explanatory comments."
  );

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    concurrency: Math.max(1, concurrency),
    totalRequests: Math.max(1, totalRequests),
    maxTokens,
    temperature: 0.3,
    prompt,
    timeoutMs,
  };
}

// ----------------------------------------------------------------------------
// Streaming Worker
// ----------------------------------------------------------------------------
async function executeStreamRequest(id: number, opts: BenchmarkOptions): Promise<RequestResult> {
  const endpoint = `${opts.baseUrl}/chat/completions`;
  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let chunkCount = 0;
  let fullText = "";
  let promptTokens = Math.ceil(opts.prompt.length / 4);
  let completionTokens = 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: opts.prompt }],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        id,
        success: false,
        statusCode: res.status,
        ttftMs: 0,
        totalDurationMs: performance.now() - startTime,
        genDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        tokensPerSec: 0,
        interTokenLatencyMs: 0,
        error: `HTTP ${res.status}: ${errText.slice(0, 150)}`,
      };
    }

    if (!res.body) {
      throw new Error("Response body is null (streaming unsupported or blocked)");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const deltaObj = parsed.choices?.[0]?.delta;
            const delta =
              (typeof deltaObj?.content === "string" ? deltaObj.content : "") +
              (typeof deltaObj?.reasoning_content === "string" ? deltaObj.reasoning_content : "") +
              (typeof deltaObj?.reasoning === "string" ? deltaObj.reasoning : "") ||
              (typeof parsed.choices?.[0]?.text === "string" ? parsed.choices[0].text : "");

            if (delta.length > 0) {
              const now = performance.now();
              if (firstTokenTime === null) {
                firstTokenTime = now;
              }
              chunkCount++;
              fullText += delta;
            }

            if (parsed.usage) {
              if (parsed.usage.prompt_tokens) promptTokens = parsed.usage.prompt_tokens;
              if (parsed.usage.completion_tokens) completionTokens = parsed.usage.completion_tokens;
            }
          } catch {
            // Ignore incomplete SSE chunk
          }
        }
      }
    }

    const endTime = performance.now();
    const totalDurationMs = endTime - startTime;
    const ttftMs = firstTokenTime ? firstTokenTime - startTime : totalDurationMs;
    const genDurationMs = firstTokenTime ? endTime - firstTokenTime : 0;

    // Fallback completion token estimation if usage not returned in SSE
    if (!completionTokens) {
      completionTokens = Math.max(chunkCount, Math.ceil(fullText.length / 4));
    }

    const genSeconds = genDurationMs / 1000;
    const tokensPerSec = genSeconds > 0 ? completionTokens / genSeconds : 0;
    const interTokenLatencyMs =
      completionTokens > 1 && genDurationMs > 0 ? genDurationMs / (completionTokens - 1) : 0;

    return {
      id,
      success: true,
      statusCode: res.status,
      ttftMs,
      totalDurationMs,
      genDurationMs,
      promptTokens,
      completionTokens,
      tokensPerSec,
      interTokenLatencyMs,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      id,
      success: false,
      statusCode: 0,
      ttftMs: 0,
      totalDurationMs: performance.now() - startTime,
      genDurationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      tokensPerSec: 0,
      interTokenLatencyMs: 0,
      error: errorMsg,
    };
  }
}

// ----------------------------------------------------------------------------
// Statistics Helpers
// ----------------------------------------------------------------------------
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ----------------------------------------------------------------------------
// Main Benchmark Runner
// ----------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log("\n============================================================");
  console.log("            LLM CONCURRENCY LOAD BENCHMARK                  ");
  console.log("============================================================");
  console.log(`Endpoint:       ${opts.baseUrl}/chat/completions`);
  console.log(`Model:          ${opts.model}`);
  console.log(`Concurrency:    ${opts.concurrency} concurrent streams`);
  console.log(`Total Requests: ${opts.totalRequests}`);
  console.log(`Max Output Tok: ${opts.maxTokens}`);
  console.log(`Prompt Length:  ~${Math.ceil(opts.prompt.length / 4)} tokens`);
  console.log("============================================================\n");
  console.log("Starting test runs...\n");

  const results: RequestResult[] = [];
  let requestCounter = 0;

  const wallClockStart = performance.now();

  // Run worker pool
  async function worker(workerId: number) {
    while (true) {
      const id = ++requestCounter;
      if (id > opts.totalRequests) break;

      const res = await executeStreamRequest(id, opts);
      results.push(res);

      if (res.success) {
        console.log(
          `[#${String(res.id).padStart(2, " ")}] Worker ${String(workerId).padStart(2, " ")} | ` +
            `TTFT: ${res.ttftMs.toFixed(0).padStart(5, " ")}ms | ` +
            `Tokens: ${String(res.completionTokens).padStart(4, " ")} | ` +
            `Speed: ${res.tokensPerSec.toFixed(1).padStart(5, " ")} tok/s | ` +
            `Total: ${(res.totalDurationMs / 1000).toFixed(2)}s`
        );
      } else {
        console.error(
          `[#${String(res.id).padStart(2, " ")}] Worker ${String(workerId).padStart(2, " ")} | ` +
            `FAILED (${res.statusCode || "CONN"}): ${res.error}`
        );
      }
    }
  }

  const workers = Array.from({ length: opts.concurrency }, (_, idx) => worker(idx + 1));
  await Promise.all(workers);

  const wallClockEnd = performance.now();
  const totalElapsedSec = (wallClockEnd - wallClockStart) / 1000;

  // ----------------------------------------------------------------------------
  // Reporting & Analysis
  // ----------------------------------------------------------------------------
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log("\n============================================================");
  console.log("                   BENCHMARK RESULTS                        ");
  console.log("============================================================");

  console.log(`Concurrency:          ${opts.concurrency}`);
  console.log(`Total Requests:       ${results.length}`);
  console.log(
    `Successful:           ${successful.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`
  );
  console.log(`Failed:               ${failed.length}`);
  console.log(`Total Wall Time:      ${totalElapsedSec.toFixed(2)}s`);

  if (successful.length === 0) {
    console.error("\n❌ All requests failed. Check endpoint URL, API key, and model ID.");
    if (failed.length > 0) {
      console.error(`Sample error: ${failed[0].error}`);
    }
    process.exit(1);
  }

  const ttftList = successful.map((r) => r.ttftMs);
  const totalDurList = successful.map((r) => r.totalDurationMs);
  const tpsList = successful.map((r) => r.tokensPerSec);
  const itlList = successful.map((r) => r.interTokenLatencyMs).filter((v) => v > 0);
  const completionTokensList = successful.map((r) => r.completionTokens);

  const totalTokensGenerated = completionTokensList.reduce((acc, t) => acc + t, 0);
  const clusterThroughput = totalTokensGenerated / totalElapsedSec;

  console.log("\n--- Latency & Responsiveness ---");
  console.log(
    `Time to First Token (TTFT):  avg: ${average(ttftList).toFixed(0)}ms | p50: ${percentile(ttftList, 50).toFixed(0)}ms | p90: ${percentile(ttftList, 90).toFixed(0)}ms | p95: ${percentile(ttftList, 95).toFixed(0)}ms`
  );
  console.log(
    `Inter-Token Latency (ITL):   avg: ${average(itlList).toFixed(1)}ms | p50: ${percentile(itlList, 50).toFixed(1)}ms | p95: ${percentile(itlList, 95).toFixed(1)}ms`
  );
  console.log(
    `Total Request Duration:      avg: ${(average(totalDurList) / 1000).toFixed(2)}s | p50: ${(percentile(totalDurList, 50) / 1000).toFixed(2)}s | p95: ${(percentile(totalDurList, 95) / 1000).toFixed(2)}s`
  );

  console.log("\n--- Generation Throughput ---");
  console.log(
    `Single-Stream Speed:         avg: ${average(tpsList).toFixed(1)} tok/s | p50: ${percentile(tpsList, 50).toFixed(1)} tok/s | max: ${Math.max(...tpsList).toFixed(1)} tok/s`
  );
  console.log(
    `Total Output Generated:      ${totalTokensGenerated} tokens (${(totalTokensGenerated / successful.length).toFixed(0)} tok/req avg)`
  );
  console.log(
    `Aggregated Cluster Throughput: ${clusterThroughput.toFixed(1)} tok/s (cumulative across ${opts.concurrency} concurrent streams)`
  );

  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("Fatal benchmark error:", err);
  process.exit(1);
});
