import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
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

function cleanError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Hermes did not answer.";
}

async function askApi(message: string, sessionId?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${hermesApiUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(sessionId ? { "X-Hermes-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [
          {
            role: "system",
            content:
              "You are talking inside Hermes Dashboard's game view. Reply in plain language for a non-technical operator.",
          },
          { role: "user", content: message },
        ],
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? data?.error ?? `Hermes API returned ${response.status}.`,
      };
    }

    return {
      ok: true,
      reply: data?.choices?.[0]?.message?.content ?? "Hermes answered, but no text came back.",
      sessionId: response.headers.get("x-hermes-session-id") ?? sessionId ?? null,
      mode: "api",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function askCli(message: string) {
  const command = process.env.HERMES_CLI_PATH ?? "hermes";
  const { stdout, stderr } = await execFileAsync(command, ["chat", "--quiet", "--query", message], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  const reply = stdout.trim() || stderr.trim();
  return {
    ok: true,
    reply: reply || "Hermes finished without a visible answer.",
    sessionId: null,
    mode: "cli",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;

  if (!message) {
    return NextResponse.json({ ok: false, error: "Say something first." }, { status: 400 });
  }

  try {
    const result = await askApi(message, sessionId);
    if (result.ok) return NextResponse.json(result);

    try {
      return NextResponse.json(await askCli(message));
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Hermes is not reachable from the dashboard yet. Enable Hermes API server or install the Hermes CLI beside the dashboard.",
          detail: result.error,
        },
        { status: 503 },
      );
    }
  } catch (error) {
    try {
      return NextResponse.json(await askCli(message));
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Hermes is not reachable from the dashboard yet. Enable Hermes API server or install the Hermes CLI beside the dashboard.",
          detail: cleanError(error),
        },
        { status: 503 },
      );
    }
  }
}
