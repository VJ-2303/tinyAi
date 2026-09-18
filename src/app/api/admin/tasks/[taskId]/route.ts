import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { updateTask, deleteTask } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const id = parseInt(taskId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
      return NextResponse.json({ error: "Task title cannot be empty" }, { status: 400 });
    }

    let revealAfterMinutes: number | null | undefined = undefined;
    if (body?.reveal_after_minutes !== undefined) {
      if (body.reveal_after_minutes === null || body.reveal_after_minutes === "") {
        revealAfterMinutes = null;
      } else {
        const parsed = Number(body.reveal_after_minutes);
        if (!isNaN(parsed) && parsed >= 0) {
          revealAfterMinutes = Math.floor(parsed);
        } else {
          revealAfterMinutes = null;
        }
      }
    }

    const updated = updateTask(id, {
      title: typeof body?.title === "string" ? body.title.trim() : undefined,
      description_markdown: typeof body?.description_markdown === "string" ? body.description_markdown.trim() : undefined,
      is_revealed: typeof body?.is_revealed === "number" ? body.is_revealed : undefined,
      order_index: typeof body?.order_index === "number" ? body.order_index : undefined,
      reveal_after_minutes: revealAfterMinutes,
    });

    if (!updated) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task: updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const id = parseInt(taskId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const success = deleteTask(id);
    return NextResponse.json({ success });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
