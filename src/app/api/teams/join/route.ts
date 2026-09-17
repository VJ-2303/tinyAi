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
    body {
      margin: 0;
      padding: 0;
      background: #111;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: sans-serif;
      overflow: hidden;
    }
    canvas {
      background: #000;
      border: 2px solid #333;
    }
  </style>
</head>
<body>
  <canvas id="gameCanvas" width="600" height="400"></canvas>
  <script src="game.js"></script>
</body>
</html>`;

      const defaultJs = `// ${team.name} - Game Script
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function draw() {
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#68d391';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Game Canvas Ready', canvas.width / 2, canvas.height / 2);
}

draw();
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
