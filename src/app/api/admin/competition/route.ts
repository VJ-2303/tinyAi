import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import {
  getCompetitionState,
  startCompetition,
  pauseCompetition,
  resumeCompetition,
  endCompetition,
  adjustCompetitionTime,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = getCompetitionState();
  return NextResponse.json({ state });
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    let updatedState;
    switch (action) {
      case "start": {
        const duration = typeof body?.durationMinutes === "number" ? body.durationMinutes : undefined;
        updatedState = startCompetition(duration);
        break;
      }
      case "pause": {
        updatedState = pauseCompetition();
        break;
      }
      case "resume": {
        updatedState = resumeCompetition();
        break;
      }
      case "end": {
        updatedState = endCompetition();
        break;
      }
      case "adjust_time": {
        const deltaSeconds = typeof body?.deltaSeconds === "number" ? body.deltaSeconds : 0;
        updatedState = adjustCompetitionTime(deltaSeconds);
        break;
      }
      default:
        return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ state: updatedState });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
