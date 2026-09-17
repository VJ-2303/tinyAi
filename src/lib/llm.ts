export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function pruneChatHistory(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  contextWindow = 4096,
  maxOutput = 1024
): ChatMessage[] {
  const systemTokens = estimateTokens(systemPrompt);
  const safetyBuffer = 100;
  const availableBudget = Math.max(200, contextWindow - maxOutput - systemTokens - safetyBuffer);

  if (history.length === 0) {
    return [{ role: "system", content: systemPrompt }];
  }

  // Work backwards from newest messages to keep as many recent messages as fit in budget
  const keptMessages: { role: "user" | "assistant"; content: string }[] = [];
  let currentTokens = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = estimateTokens(msg.content) + 4; // account for message formatting overhead
    if (keptMessages.length === 0 || currentTokens + msgTokens <= availableBudget) {
      keptMessages.unshift(msg);
      currentTokens += msgTokens;
    } else {
      // Exceeded budget, remaining older messages are pruned
      break;
    }
  }

  return [
    { role: "system", content: systemPrompt },
    ...keptMessages,
  ];
}

export async function queryVLLM(messages: ChatMessage[]): Promise<string> {
  const baseUrl = process.env.VLLM_BASE_URL || "http://localhost:8000/v1";
  const model = process.env.VLLM_MODEL || "Qwen/Qwen2.5-Coder-0.5B-Instruct";
  const apiKey = process.env.VLLM_API_KEY || "dummy-key";
  const maxTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 1024);

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`vLLM server responded with ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error("No response content received from vLLM");
    }

    return reply;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // If local vLLM is offline or connection refused, provide an informative local fallback
    if (errMsg.includes("fetch failed") || errMsg.includes("ECONNREFUSED") || errMsg.includes("timeout")) {
      const latestUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      return (
        `[vLLM Offline Mode] LLM server at ${baseUrl} is unreachable.\n\n` +
        `Prompt received: "${latestUserMsg.slice(0, 100)}"\n\n` +
        `Start the local vLLM server to generate live responses.`
      );
    }

    throw error;
  }
}
