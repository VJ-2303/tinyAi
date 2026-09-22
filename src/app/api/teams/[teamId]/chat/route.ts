import { NextRequest, NextResponse } from "next/server";
import {
  getTeamById,
  getChatHistory,
  recordPrompt,
  canTeamPrompt,
} from "@/lib/db";
import { pruneChatHistory, queryVLLM, streamVLLM } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const team = getTeamById(teamId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const history = getChatHistory(teamId);
    return NextResponse.json({
      history,
      prompt_count: team.prompt_count,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const team = getTeamById(teamId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const cooldownSeconds = Number(process.env.RATE_LIMIT_COOLDOWN_SECONDS || 10);
    const check = canTeamPrompt(teamId, cooldownSeconds);

    if (!check.allowed) {
      if (check.remainingCooldown > 0) {
        return NextResponse.json(
          {
            error: check.reason || "Rate limit cooldown active",
            remainingSeconds: check.remainingCooldown,
            remainingCooldown: check.remainingCooldown,
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: check.reason || "Chat is currently disabled" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    // 1. Fetch prior conversation history from DB
    const existingHistory = getChatHistory(teamId);

    // 2. Include current user prompt in history for model context
    const fullHistory = [
      ...existingHistory,
      { role: "user" as const, content: message },
    ];

    // 3. Estimate tokens & prune history FIFO according to configured context window budget
    const systemPrompt =
      process.env.SYSTEM_PROMPT ||
      "You are a helpful coding assistant for a fast-paced HTML game hackathon. Keep answers concise, direct, and code-centric.";
    const contextWindow = Number(process.env.LLM_CONTEXT_WINDOW_TOKENS || 4096);
    const maxOutput = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 1024);

    const prunedPayload = pruneChatHistory(systemPrompt, fullHistory, contextWindow, maxOutput);

    const isStream = body?.stream === true;

    if (isStream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          try {
            let fullReply = "";
            for await (const token of streamVLLM(prunedPayload)) {
              fullReply += token;
              const sseLine = `data: ${JSON.stringify({ token })}\n\n`;
              controller.enqueue(encoder.encode(sseLine));
            }

            // Record user prompt and assistant response in DB
            recordPrompt(teamId, "user", message);
            const assistantRecord = recordPrompt(
              teamId,
              "assistant",
              fullReply || "No response generated."
            );
            const updatedTeam = getTeamById(teamId);

            const doneLine = `data: ${JSON.stringify({
              done: true,
              message: assistantRecord,
              prompt_count: updatedTeam?.prompt_count || team.prompt_count + 1,
              remainingCooldown: cooldownSeconds,
            })}\n\n`;
            controller.enqueue(encoder.encode(doneLine));
            controller.close();
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const errLine = `data: ${JSON.stringify({ error: errorMsg })}\n\n`;
            controller.enqueue(encoder.encode(errLine));
            controller.close();
          }
        },
      });

      return new Response(customReadable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    // 4. Non-streaming query vLLM (or fallback offline mock if unreachable)
    const reply = await queryVLLM(prunedPayload);

    // 5. Success! Now record user prompt (which increments prompt_count) and assistant response
    recordPrompt(teamId, "user", message);
    const assistantRecord = recordPrompt(teamId, "assistant", reply);

    const updatedTeam = getTeamById(teamId);

    return NextResponse.json({
      message: assistantRecord,
      prompt_count: updatedTeam?.prompt_count || team.prompt_count + 1,
      remainingCooldown: cooldownSeconds,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
