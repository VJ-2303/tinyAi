import { NextRequest, NextResponse } from "next/server";
import {
  getTeamById,
  getTeamFiles,
  upsertFile,
  deleteFile,
  getCompetitionState,
} from "@/lib/db";

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

    const files = getTeamFiles(teamId);
    return NextResponse.json({ files, team });
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

    // Lock checks: competition state & proctoring lockout
    const state = getCompetitionState();
    if (state.status !== "RUNNING") {
      return NextResponse.json(
        { error: `Cannot edit files: Competition is ${state.status.toLowerCase()}` },
        { status: 403 }
      );
    }

    if (team.is_locked) {
      return NextResponse.json(
        { error: "Cannot edit files: Workstation is locked due to proctoring strikes" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const content = typeof body?.content === "string" ? body.content : "";

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }

    // Basic filename sanitization
    if (filename.includes("..") || filename.startsWith("/")) {
      return NextResponse.json({ error: "Invalid filename path" }, { status: 400 });
    }

    const file = upsertFile(teamId, filename, content);
    return NextResponse.json({ file });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const team = getTeamById(teamId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const state = getCompetitionState();
    if (state.status !== "RUNNING") {
      return NextResponse.json(
        { error: `Cannot delete files: Competition is ${state.status.toLowerCase()}` },
        { status: 403 }
      );
    }

    if (team.is_locked) {
      return NextResponse.json(
        { error: "Cannot delete files: Workstation is locked due to proctoring strikes" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const filename = searchParams.get("filename");
    if (!filename) {
      return NextResponse.json({ error: "Filename query parameter required" }, { status: 400 });
    }

    const cleanFilename = filename.trim().replace(/^(\.\/|\/)+/, "");
    if (!cleanFilename || cleanFilename.includes("..") || cleanFilename.startsWith("/")) {
      return NextResponse.json({ error: "Invalid filename path" }, { status: 400 });
    }

    if (cleanFilename === "index.html") {
      return NextResponse.json({ error: "Cannot delete root index.html file" }, { status: 400 });
    }

    const success = deleteFile(teamId, cleanFilename);
    return NextResponse.json({ success });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
