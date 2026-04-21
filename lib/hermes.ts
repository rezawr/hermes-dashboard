import { promises as fs } from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

type CronJob = {
  id: string;
  name: string;
  schedule_display?: string;
  enabled?: boolean;
  state?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  repeat?: {
    completed?: number;
  };
  origin?: {
    platform?: string;
  };
};

type GatewayState = {
  gateway_state?: string;
  updated_at?: string;
  pid?: number;
  platforms?: Record<string, { state?: string; updated_at?: string }>;
};

type CronRun = {
  jobId: string;
  jobName: string;
  filename: string;
  runAt: string | null;
  status: string;
  excerpt: string;
};

export type SessionPhase = "processing" | "idle" | "awaiting_input" | "needs_approval";

export type SessionSummary = {
  id: string;
  source: string;
  model: string | null;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  phase: SessionPhase;
  phaseReason: string;
  parentSessionId: string | null;
  childSessionCount: number;
  contextUtilization: number;
};

export type ActivityItem = {
  id: string;
  sessionId: string;
  timestamp: number;
  type: "message" | "tool_call" | "approval";
  role: string | null;
  label: string;
  detail: string;
  tone: "neutral" | "good" | "bad" | "warn";
};

export type SessionDetail = {
  session: SessionSummary | null;
  toolTimeline: Array<{
    id: string;
    timestamp: number;
    toolName: string;
    detail: string;
    outcome: "ok" | "error" | "pending";
  }>;
  timeline: Array<{
    id: string;
    timestamp: number;
    role: string;
    kind: "message" | "tool_call" | "tool_result" | "approval";
    label: string;
    detail: string;
  }>;
  toolBreakdown: Array<{
    toolName: string;
    count: number;
  }>;
  subagents: Array<{
    id: string;
    source: string;
    startedAt: number;
    endedAt: number | null;
    totalTokens: number;
    phase: SessionPhase;
  }>;
  messageStats: {
    user: number;
    assistant: number;
    tool: number;
  };
};

export type DashboardData = {
  generatedAt: string;
  summary: {
    totalTokens: number;
    totalSessions: number;
    totalMessages: number;
    totalCronJobs: number;
    enabledCronJobs: number;
    failedCronJobs: number;
    gatewayState: string;
    latestRunAt: string | null;
    estimatedCostUsd: number;
  };
  gateway: GatewayState | null;
  cronJobs: CronJob[];
  cronRuns: CronRun[];
  sessions: SessionSummary[];
  activityFeed: ActivityItem[];
  selectedSession: SessionDetail | null;
  platformBreakdown: Array<{
    source: string;
    sessions: number;
    totalTokens: number;
  }>;
};

type MessageRow = {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number;
  token_count: number | null;
  finish_reason: string | null;
};

type SessionRow = {
  id: string;
  source: string;
  model: string | null;
  parent_session_id: string | null;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  title: string | null;
  last_activity_at: number;
  child_session_count: number;
};

function getHermesHome() {
  return process.env.HERMES_HOME ?? process.env.HERMES_DATA_DIR ?? path.join(process.env.HOME ?? "", ".hermes");
}

function safeDateValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function detectApprovalText(text: string) {
  return /approve|approval|deny|dangerous command|allow this command/i.test(text);
}

function looksError(text: string) {
  return /"exit_code":\s*[1-9]|"error"\s*:\s*".+?"|timeout|failed|traceback|exception/i.test(text);
}

function clip(value: string | null | undefined, max = 140) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseToolCalls(raw: string | null): Array<{ id?: string; function?: { name?: string; arguments?: string } }> {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function derivePhase(messages: MessageRow[], endedAt: number | null): { phase: SessionPhase; reason: string } {
  if (!messages.length) {
    return {
      phase: endedAt ? "idle" : "awaiting_input",
      reason: endedAt ? "Session ended." : "No persisted messages yet.",
    };
  }

  const latest = messages[messages.length - 1];
  const latestText = `${latest.content ?? ""} ${latest.tool_calls ?? ""}`;

  if (detectApprovalText(latestText)) {
    return { phase: "needs_approval", reason: "Latest persisted event looks like an approval prompt." };
  }

  if (latest.role === "tool") {
    return { phase: "processing", reason: "Latest event is a tool result, so the turn is still tool-driven." };
  }

  if (latest.role === "assistant" && latest.finish_reason === "tool_calls") {
    return { phase: "processing", reason: "Latest assistant message requested tool execution." };
  }

  if (endedAt) {
    return { phase: "idle", reason: "Session has an end timestamp." };
  }

  if (latest.role === "assistant") {
    return { phase: "awaiting_input", reason: "Latest persisted message is assistant output." };
  }

  return { phase: "processing", reason: "Latest persisted message is user input without a completed assistant reply." };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readCronRuns(hermesHome: string, cronJobs: CronJob[]) {
  const outputRoot = path.join(hermesHome, "cron", "output");
  const jobNameById = new Map(cronJobs.map((job) => [job.id, job.name]));
  let jobDirs: string[] = [];

  try {
    jobDirs = await fs.readdir(outputRoot);
  } catch {
    return [] as CronRun[];
  }

  const runs: CronRun[] = [];
  for (const jobId of jobDirs) {
    const fullDir = path.join(outputRoot, jobId);
    let files: string[] = [];
    try {
      files = await fs.readdir(fullDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) {
        continue;
      }
      const content = await fs.readFile(path.join(fullDir, file), "utf8").catch(() => "");
      const excerpt = clip(content, 180);
      const status = /error|timeout|failed/i.test(content) ? "error" : "ok";
      const match = file.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/);
      const isoGuess = match
        ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`).toISOString()
        : null;
      runs.push({
        jobId,
        jobName: jobNameById.get(jobId) ?? jobId,
        filename: file,
        runAt: isoGuess,
        status,
        excerpt,
      });
    }
  }

  runs.sort((a, b) => safeDateValue(b.runAt) - safeDateValue(a.runAt));
  return runs.slice(0, 12);
}

async function openDb(dbPath: string) {
  return new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(database);
    });
  });
}

async function querySqliteDashboard(hermesHome: string) {
  const dbPath = path.join(hermesHome, "state.db");
  const db = await openDb(dbPath).catch(() => null);

  const empty = {
    totals: {
      totalSessions: 0,
      totalMessages: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    },
    sessions: [] as SessionSummary[],
    sessionDetails: new Map<string, SessionDetail>(),
    activityFeed: [] as ActivityItem[],
    platformBreakdown: [] as Array<{ source: string; sessions: number; totalTokens: number }>,
  };

  if (!db) {
    return empty;
  }

  const all = <T>(sql: string, params: (string | number)[] = []) =>
    new Promise<T[]>((resolve, reject) => {
      db.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows as T[]);
      });
    });

  const get = <T>(sql: string, params: (string | number)[] = []) =>
    new Promise<T>((resolve, reject) => {
      db.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row as T);
      });
    });

  try {
    const totals = await get<{
      total_sessions: number;
      total_messages: number;
      total_tokens: number;
      estimated_cost_usd: number | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sessions) AS total_sessions,
        (SELECT COUNT(*) FROM messages) AS total_messages,
        (SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) FROM sessions) AS total_tokens,
        (SELECT COALESCE(SUM(COALESCE(estimated_cost_usd, 0)), 0) FROM sessions) AS estimated_cost_usd
    `);

    const sessionRows = await all<SessionRow>(`
      SELECT
        s.id,
        s.source,
        s.model,
        s.parent_session_id,
        s.started_at,
        s.ended_at,
        s.end_reason,
        s.message_count,
        s.tool_call_count,
        s.input_tokens,
        s.output_tokens,
        s.estimated_cost_usd,
        s.title,
        COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_activity_at,
        (SELECT COUNT(*) FROM sessions child WHERE child.parent_session_id = s.id) AS child_session_count
      FROM sessions s
      ORDER BY last_activity_at DESC
      LIMIT 20
    `);

    const ids = sessionRows.map((row) => row.id);
    const sessionMessageRows = ids.length
      ? await all<MessageRow>(
          `SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, token_count, finish_reason
           FROM messages
           WHERE session_id IN (${ids.map(() => "?").join(",")})
           ORDER BY timestamp ASC, id ASC`,
          ids,
        )
      : [];

    const bySession = new Map<string, MessageRow[]>();
    for (const row of sessionMessageRows) {
      const bucket = bySession.get(row.session_id) ?? [];
      bucket.push(row);
      bySession.set(row.session_id, bucket);
    }

    const sessions: SessionSummary[] = sessionRows.map((row) => {
      const phaseInfo = derivePhase(bySession.get(row.id) ?? [], row.ended_at);
      const totalTokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      return {
        id: row.id,
        source: row.source,
        model: row.model,
        title: row.title,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        lastActivityAt: row.last_activity_at,
        endReason: row.end_reason,
        messageCount: row.message_count,
        toolCallCount: row.tool_call_count,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        totalTokens,
        estimatedCostUsd: row.estimated_cost_usd ?? 0,
        phase: phaseInfo.phase,
        phaseReason: phaseInfo.reason,
        parentSessionId: row.parent_session_id,
        childSessionCount: row.child_session_count,
        contextUtilization: Math.min(100, Math.round((totalTokens / 64000) * 100)),
      };
    });

    const activityRows = await all<MessageRow>(`
      SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, token_count, finish_reason
      FROM messages
      ORDER BY timestamp DESC, id DESC
      LIMIT 80
    `);

    const activityFeed: ActivityItem[] = [];
    for (const row of activityRows) {
      const rawText = `${row.content ?? ""} ${row.tool_calls ?? ""}`;
      if (detectApprovalText(rawText)) {
        activityFeed.push({
          id: `approval-${row.id}`,
          sessionId: row.session_id,
          timestamp: row.timestamp,
          type: "approval",
          role: row.role,
          label: "Approval",
          detail: clip(rawText),
          tone: "warn",
        });
      }

      if (row.role === "assistant" && row.tool_calls) {
        for (const call of parseToolCalls(row.tool_calls)) {
          const name = call.function?.name ?? "unknown_tool";
          activityFeed.push({
            id: `tool-${row.id}-${call.id ?? name}`,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            type: "tool_call",
            role: row.role,
            label: name,
            detail: clip(call.function?.arguments ?? rawText),
            tone: name === "delegate_task" ? "good" : "neutral",
          });
        }
      } else if (row.role !== "assistant" || !row.tool_calls) {
        activityFeed.push({
          id: `msg-${row.id}`,
          sessionId: row.session_id,
          timestamp: row.timestamp,
          type: "message",
          role: row.role,
          label: row.role,
          detail: clip(rawText),
          tone: row.role === "tool" && looksError(rawText) ? "bad" : "neutral",
        });
      }
    }

    const platformBreakdown = await all<{ source: string; sessions: number; total_tokens: number }>(`
      SELECT
        COALESCE(source, 'unknown') AS source,
        COUNT(*) AS sessions,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS total_tokens
      FROM sessions
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY total_tokens DESC, sessions DESC
    `);

    const sessionDetails = new Map<string, SessionDetail>();
    for (const session of sessions) {
      const messages = bySession.get(session.id) ?? [];
      const toolTimeline: SessionDetail["toolTimeline"] = [];
      const timeline: SessionDetail["timeline"] = [];
      const toolCounts = new Map<string, number>();
      let userCount = 0;
      let assistantCount = 0;
      let toolCount = 0;

      for (const message of messages) {
        if (message.role === "user") {
          userCount += 1;
        } else if (message.role === "assistant") {
          assistantCount += 1;
        } else if (message.role === "tool") {
          toolCount += 1;
        }

        const combined = `${message.content ?? ""} ${message.tool_calls ?? ""}`;
        if (detectApprovalText(combined)) {
          timeline.push({
            id: `approval-${message.id}`,
            timestamp: message.timestamp,
            role: message.role,
            kind: "approval",
            label: "Approval",
            detail: clip(combined),
          });
        }

        if (message.role === "assistant" && message.tool_calls) {
          const calls = parseToolCalls(message.tool_calls);
          for (const call of calls) {
            const toolName = call.function?.name ?? "unknown_tool";
            toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
            const detail = clip(call.function?.arguments ?? "");
            toolTimeline.push({
              id: `tool-${message.id}-${call.id ?? toolName}`,
              timestamp: message.timestamp,
              toolName,
              detail,
              outcome: "pending",
            });
            timeline.push({
              id: `toolcall-${message.id}-${call.id ?? toolName}`,
              timestamp: message.timestamp,
              role: message.role,
              kind: "tool_call",
              label: toolName,
              detail,
            });
          }
        } else if (message.role === "tool") {
          timeline.push({
            id: `toolresult-${message.id}`,
            timestamp: message.timestamp,
            role: message.role,
            kind: "tool_result",
            label: message.tool_call_id ?? "tool_result",
            detail: clip(message.content),
          });
        } else {
          timeline.push({
            id: `msg-${message.id}`,
            timestamp: message.timestamp,
            role: message.role,
            kind: "message",
            label: message.role,
            detail: clip(message.content),
          });
        }
      }

      for (let i = 0; i < toolTimeline.length; i += 1) {
        const nextToolResult = messages.find(
          (message) =>
            message.role === "tool" &&
            message.tool_call_id &&
            message.timestamp >= toolTimeline[i].timestamp,
        );
        if (nextToolResult) {
          toolTimeline[i].outcome = looksError(nextToolResult.content ?? "") ? "error" : "ok";
        }
      }

      const subagentRows = await all<SessionRow>(
        `
          SELECT
            s.id,
            s.source,
            s.model,
            s.parent_session_id,
            s.started_at,
            s.ended_at,
            s.end_reason,
            s.message_count,
            s.tool_call_count,
            s.input_tokens,
            s.output_tokens,
            s.estimated_cost_usd,
            s.title,
            COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_activity_at,
            (SELECT COUNT(*) FROM sessions child WHERE child.parent_session_id = s.id) AS child_session_count
          FROM sessions s
          WHERE s.parent_session_id = ?
          ORDER BY s.started_at ASC
        `,
        [session.id],
      );

      const subagents = subagentRows.map((row) => {
        const relatedMessages = bySession.get(row.id) ?? [];
        const phaseInfo = derivePhase(relatedMessages, row.ended_at);
        return {
          id: row.id,
          source: row.source,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          totalTokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
          phase: phaseInfo.phase,
        };
      });

      sessionDetails.set(session.id, {
        session,
        toolTimeline: toolTimeline.sort((a, b) => b.timestamp - a.timestamp).slice(0, 24),
        timeline: timeline.sort((a, b) => a.timestamp - b.timestamp).slice(-36),
        toolBreakdown: [...toolCounts.entries()]
          .map(([toolName, count]) => ({ toolName, count }))
          .sort((a, b) => b.count - a.count),
        subagents,
        messageStats: {
          user: userCount,
          assistant: assistantCount,
          tool: toolCount,
        },
      });
    }

    return {
      totals: {
        totalSessions: totals.total_sessions,
        totalMessages: totals.total_messages,
        totalTokens: totals.total_tokens,
        estimatedCostUsd: totals.estimated_cost_usd ?? 0,
      },
      sessions,
      sessionDetails,
      activityFeed: activityFeed.sort((a, b) => b.timestamp - a.timestamp).slice(0, 40),
      platformBreakdown: platformBreakdown.map((row) => ({
        source: row.source,
        sessions: row.sessions,
        totalTokens: row.total_tokens,
      })),
    };
  } catch {
    return empty;
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
}

function latestRunAt(cronJobs: CronJob[], cronRuns: CronRun[]) {
  const candidates = [
    ...cronJobs.map((job) => job.last_run_at).filter(Boolean),
    ...cronRuns.map((run) => run.runAt).filter(Boolean),
  ] as string[];
  return candidates.length ? candidates.sort((a, b) => safeDateValue(b) - safeDateValue(a))[0] : null;
}

export async function loadDashboardData(selectedSessionId?: string): Promise<DashboardData> {
  const hermesHome = getHermesHome();
  const cronJson = await readJsonFile<{ jobs?: CronJob[] }>(path.join(hermesHome, "cron", "jobs.json"), {});
  const gateway = await readJsonFile<GatewayState | null>(path.join(hermesHome, "gateway_state.json"), null);
  const sqlite = await querySqliteDashboard(hermesHome);
  const cronJobs = (cronJson.jobs ?? []).sort((a, b) => safeDateValue(a.next_run_at) - safeDateValue(b.next_run_at));
  const cronRuns = await readCronRuns(hermesHome, cronJobs);
  const selectedId = selectedSessionId ?? sqlite.sessions[0]?.id ?? null;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalTokens: sqlite.totals.totalTokens,
      totalSessions: sqlite.totals.totalSessions,
      totalMessages: sqlite.totals.totalMessages,
      totalCronJobs: cronJobs.length,
      enabledCronJobs: cronJobs.filter((job) => job.enabled).length,
      failedCronJobs: cronJobs.filter((job) => job.last_status === "error").length,
      gatewayState: gateway?.gateway_state ?? "unknown",
      latestRunAt: latestRunAt(cronJobs, cronRuns),
      estimatedCostUsd: sqlite.totals.estimatedCostUsd,
    },
    gateway,
    cronJobs,
    cronRuns,
    sessions: sqlite.sessions,
    activityFeed: sqlite.activityFeed,
    selectedSession: selectedId ? sqlite.sessionDetails.get(selectedId) ?? null : null,
    platformBreakdown: sqlite.platformBreakdown,
  };
}
