import { NextRequest, NextResponse } from "next/server";
import { getTeamById, recordViolation, getCompetitionState } from "@/lib/db";

export const dynamic = "force-dynamic";

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

    // Only enforce proctoring strikes while competition is RUNNING and team is unlocked
    const state = getCompetitionState();
    if (state.status !== "RUNNING") {
      return NextResponse.json({
        message: "Proctoring violation ignored: competition is not running",
        strike_count: team.strike_count,
        is_locked: team.is_locked,
      });
    }

    if (team.is_locked) {
      return NextResponse.json({
        message: "Proctoring violation ignored: workstation is already locked",
        strike_count: team.strike_count,
        is_locked: team.is_locked,
      });
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : "FOCUS_LOST";

    const { team: updatedTeam, violation } = recordViolation(teamId, reason);

    return NextResponse.json({
      strike_count: updatedTeam.strike_count,
      is_locked: updatedTeam.is_locked,
      violation,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
