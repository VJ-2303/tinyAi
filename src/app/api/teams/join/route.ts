import { NextRequest, NextResponse } from "next/server";
import { registerOrResumeTeam, getTeamFiles, upsertFile } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Team name must be at least 2 characters long" },
        { status: 400 }
      );
    }

    if (name.length > 50) {
      return NextResponse.json(
        { error: "Team name cannot exceed 50 characters" },
        { status: 400 }
      );
    }

    const { team, isNew } = registerOrResumeTeam(name);
    let files = getTeamFiles(team.id);

    // If completely new team with no files, initialize standard blank starter canvas
    if (files.length === 0) {
      const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${team.name} - Game</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #09090b;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <canvas id="gameCanvas"></canvas>
  <script src="game.js"></script>
</body>
</html>`;

      const defaultJs = `const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width = (canvas.width = window.innerWidth);
let height = (canvas.height = window.innerHeight);

window.addEventListener('resize', () => {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
});

function loop() {
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, width, height);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
`;

      upsertFile(team.id, "index.html", defaultHtml);
      upsertFile(team.id, "game.js", defaultJs);
      files = getTeamFiles(team.id);
    }

    return NextResponse.json({
      team,
      files,
      isNew,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
