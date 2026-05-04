import { NextResponse } from "next/server";
import { prepareGameData } from "../../../../lib/game-data";
import { loadDashboardData } from "../../../../lib/hermes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await loadDashboardData();

    return NextResponse.json(
      { ok: true, data: prepareGameData(data) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to check Hermes right now.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
