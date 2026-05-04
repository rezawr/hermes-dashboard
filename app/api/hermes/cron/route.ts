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

function readCronBody(body: unknown) {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    name: typeof source.name === "string" ? source.name.trim() : "",
    schedule: typeof source.schedule === "string" ? source.schedule.trim() : "",
    prompt: typeof source.prompt === "string" ? source.prompt.trim() : "",
    deliver: typeof source.deliver === "string" ? source.deliver.trim() : "local",
  };
}

async function createViaApi(job: { name: string; schedule: string; prompt: string; deliver: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${hermesApiUrl()}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(job),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: data?.error ?? `Hermes API returned ${response.status}.` };
    }
    return { ok: true, job: data.job, mode: "api" };
  } finally {
    clearTimeout(timeout);
  }
}

async function createViaCli(job: { name: string; schedule: string; prompt: string; deliver: string }) {
  const command = process.env.HERMES_CLI_PATH ?? "hermes";
  const args = ["cron", "create", job.schedule, job.prompt, "--name", job.name, "--deliver", job.deliver || "local"];
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  return {
    ok: true,
    message: stdout.trim() || stderr.trim() || "Worker created.",
    mode: "cli",
  };
}

export async function POST(request: NextRequest) {
  const job = readCronBody(await request.json().catch(() => null));

  if (!job.name) {
    return NextResponse.json({ ok: false, error: "Give this worker a name." }, { status: 400 });
  }
  if (!job.schedule) {
    return NextResponse.json({ ok: false, error: "Choose when the worker should wake up." }, { status: 400 });
  }
  if (!job.prompt) {
    return NextResponse.json({ ok: false, error: "Tell the worker what to do." }, { status: 400 });
  }

  try {
    const result = await createViaApi(job);
    if (result.ok) return NextResponse.json(result);

    try {
      return NextResponse.json(await createViaCli(job));
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "I could not create the worker because Hermes is not reachable. Enable Hermes API server or install the Hermes CLI beside the dashboard.",
          detail: result.error,
        },
        { status: 503 },
      );
    }
  } catch (error) {
    try {
      return NextResponse.json(await createViaCli(job));
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "I could not create the worker because Hermes is not reachable. Enable Hermes API server or install the Hermes CLI beside the dashboard.",
          detail: error instanceof Error ? error.message : "Unknown error.",
        },
        { status: 503 },
      );
    }
  }
}
