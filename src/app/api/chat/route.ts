import { NextRequest, NextResponse } from "next/server";

import { runAgent } from "@/lib/runner";
import { ProviderChoice } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string;
      providerId?: ProviderChoice;
    };

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const result = await runAgent({
      message: body.message,
      providerId: body.providerId || "auto",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
