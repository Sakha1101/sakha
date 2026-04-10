import { execFile } from "child_process";
import { promisify } from "util";

import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      code?: string;
      language?: "javascript" | "python";
    };

    if (!body.code?.trim()) {
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          error:
            "Code execution is available in Sakha when you run it on your laptop. The hosted app keeps this disabled for safety.",
        },
        { status: 400 },
      );
    }

    if (body.language === "python") {
      const result = await execFileAsync("python", ["-c", body.code], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return NextResponse.json({ output: [result.stdout, result.stderr].filter(Boolean).join("\n") });
    }

    const result = await execFileAsync("node", ["-e", body.code], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    return NextResponse.json({ output: [result.stdout, result.stderr].filter(Boolean).join("\n") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
