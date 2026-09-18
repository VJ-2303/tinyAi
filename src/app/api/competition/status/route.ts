import { NextResponse } from "next/server";
import { getCompetitionState, getTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = getCompetitionState();
    const elapsedSeconds = (state.status === "RUNNING" || state.status === "PAUSED" || state.status === "ENDED")
      ? Math.max(0, (state.duration_minutes * 60) - state.remaining_seconds)
      : -1;
    const revealedTasks = getTasks(true, elapsedSeconds);

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
