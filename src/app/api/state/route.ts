import { NextResponse } from "next/server";

import { getAppState } from "@/lib/storage";

export async function GET() {
  return NextResponse.json(await getAppState());
}
