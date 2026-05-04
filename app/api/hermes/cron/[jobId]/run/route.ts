import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_HERMES_API_URL = "http://127.0.0.1:8642";

function hermesApiUrl() {
  return (
    process.env.HERMES_API_URL ??
    process.env.HERMES_GATEWAY_URL ??
    DEFAULT_HERMES_API_URL
  ).replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const key = process.env.HERMES_API_KEY ?? process.env.API_SERVER_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const response = await fetch(`${hermesApiUrl()}/api/jobs/${encodeURIComponent(jobId)}/run`, {
    method: "POST",
    headers: authHeaders(),
  }).catch((error) => error as Error);

  if (response instanceof Error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Hermes is not reachable, so I could not wake this worker now.",
        detail: response.message,
      },
      { status: 503 },
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: data?.error ?? `Hermes API returned ${response.status}.` },
      { status: response.status },
    );
  }

  return NextResponse.json({ ok: true, job: data.job });
}
