import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getTasks, createTask } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tasks = getTasks(false); // all tasks including drafts
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description_markdown === "string" ? body.description_markdown : "";
    const orderIndex = typeof body?.order_index === "number" ? body.order_index : undefined;

    let revealAfterMinutes: number | null = null;
    if (typeof body?.reveal_after_minutes === "number" && !isNaN(body.reveal_after_minutes) && body.reveal_after_minutes >= 0) {
      revealAfterMinutes = Math.floor(body.reveal_after_minutes);
    } else if (typeof body?.reveal_after_minutes === "string" && body.reveal_after_minutes.trim() !== "" && !isNaN(Number(body.reveal_after_minutes))) {
      const parsed = Number(body.reveal_after_minutes);
      if (parsed >= 0) revealAfterMinutes = Math.floor(parsed);
    }

    if (!title) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 });
    }

    const task = createTask(title, description, orderIndex, revealAfterMinutes);
    return NextResponse.json({ task });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
