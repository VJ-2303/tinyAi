import { NextResponse } from "next/server";
import { getCompetitionState, getTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = getCompetitionState();
    const revealedTasks = getTasks(true);

    return NextResponse.json({
      status: state.status,
      duration_minutes: state.duration_minutes,
      remaining_seconds: state.remaining_seconds,
      started_at: state.started_at,
      paused_at: state.paused_at,
      tasks: revealedTasks,
      server_time: Date.now(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
