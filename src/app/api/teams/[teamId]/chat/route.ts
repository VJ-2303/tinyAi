import { NextRequest, NextResponse } from "next/server";
import {
  getTeamById,
  getChatHistory,
  recordPrompt,
  canTeamPrompt,
} from "@/lib/db";
import { pruneChatHistory, queryVLLM } from "@/lib/llm";

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

    // 1. Record user prompt in database (increments team prompt_count)
    recordPrompt(teamId, "user", message);

    // 2. Fetch full conversation history from DB
    const allHistory = getChatHistory(teamId);

    // 3. Estimate tokens & prune history FIFO according to configured context window budget
    const systemPrompt =
      process.env.SYSTEM_PROMPT ||
      "You are a helpful coding assistant for a fast-paced HTML game hackathon. Keep answers concise, direct, and code-centric.";
    const contextWindow = Number(process.env.LLM_CONTEXT_WINDOW_TOKENS || 4096);
    const maxOutput = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 1024);

    const prunedPayload = pruneChatHistory(systemPrompt, allHistory, contextWindow, maxOutput);

    // 4. Query vLLM (or fallback offline mock if unreachable)
    const reply = await queryVLLM(prunedPayload);

    // 5. Record assistant response in database
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
