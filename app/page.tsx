import Link from "next/link";
import { loadDashboardData, type SessionPhase } from "../lib/hermes";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "N/A";
  }
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function phaseTone(phase: SessionPhase) {
  if (phase === "processing") return "good";
  if (phase === "needs_approval") return "warn";
  if (phase === "awaiting_input") return "neutral";
  return "subtle";
}

function activityTone(tone: "neutral" | "good" | "bad" | "warn") {
  if (tone === "good") return "good";
  if (tone === "bad") return "bad";
  if (tone === "warn") return "warn";
  return "subtle";
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ session?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const data = await loadDashboardData(params?.session);
  const selected = data.selectedSession;

  return (
    <main className="page-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Hermes</p>
          <h1>Sessions</h1>
        </div>
        <div className="topbar-meta">
          <div>
            <span>Gateway</span>
            <strong className={`tone-${phaseTone(data.summary.gatewayState === "running" ? "processing" : "idle")}`}>
              {data.summary.gatewayState}
            </strong>
          </div>
          <div>
            <span>Latest run</span>
            <strong>{formatDate(data.summary.latestRunAt)}</strong>
          </div>
          <div>
            <span>Updated</span>
            <strong>{formatDate(data.generatedAt)}</strong>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Tokens</span>
          <strong>{formatNumber(data.summary.totalTokens)}</strong>
          <small>input + output</small>
        </article>
        <article className="stat-card">
          <span>Sessions</span>
          <strong>{formatNumber(data.summary.totalSessions)}</strong>
          <small>{formatNumber(data.summary.totalMessages)} messages</small>
        </article>
        <article className="stat-card">
          <span>Cron</span>
          <strong>
            {data.summary.enabledCronJobs}/{data.summary.totalCronJobs}
          </strong>
          <small>{data.summary.failedCronJobs} failed</small>
        </article>
        <article className="stat-card">
          <span>Cost</span>
          <strong>{formatMoney(data.summary.estimatedCostUsd)}</strong>
          <small>estimated</small>
        </article>
      </section>

      <section className="workspace-grid">
        <section className="panel session-list-panel">
          <div className="panel-heading">
            <h2>Session monitor</h2>
            <span>{data.sessions.length}</span>
          </div>
          <div className="session-list">
            {data.sessions.map((session) => {
              const isActive = selected?.session?.id === session.id;
              return (
                <Link
                  key={session.id}
                  href={`/?session=${encodeURIComponent(session.id)}`}
                  className={`session-row ${isActive ? "active" : ""}`}
                >
                  <div className="session-row-head">
                    <strong>{session.title || session.id}</strong>
                    <span className={`pill ${phaseTone(session.phase)}`}>{session.phase.replace("_", " ")}</span>
                  </div>
                  <div className="session-row-meta">
                    <span>{session.source}</span>
                    <span>{formatNumber(session.totalTokens)} tokens</span>
                    <span>{formatDate(session.lastActivityAt)}</span>
                  </div>
                  <p>{session.phaseReason}</p>
                  <div className="context-bar">
                    <div className="context-fill" style={{ width: `${session.contextUtilization}%` }} />
                  </div>
                  <div className="session-row-meta">
                    <span>{session.toolCallCount} tool calls</span>
                    <span>{session.childSessionCount} subagents</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="panel detail-panel">
          <div className="detail-panel-scroll">
            <div className="panel-heading">
              <h2>{selected?.session?.title || selected?.session?.id || "Session detail"}</h2>
              {selected?.session ? (
                <span className={`pill ${phaseTone(selected.session.phase)}`}>{selected.session.phase.replace("_", " ")}</span>
              ) : null}
            </div>

            {selected?.session ? (
              <>
                <div className="detail-metrics">
                  <div className="metric-block">
                    <span>Context window</span>
                    <strong>{selected.session.contextUtilization}%</strong>
                    <div className="context-bar large">
                      <div className="context-fill" style={{ width: `${selected.session.contextUtilization}%` }} />
                    </div>
                  </div>
                  <div className="metric-block">
                    <span>Message mix</span>
                    <strong>
                      {selected.messageStats.user}/{selected.messageStats.assistant}/{selected.messageStats.tool}
                    </strong>
                    <small>user / assistant / tool</small>
                  </div>
                  <div className="metric-block">
                    <span>Tokens</span>
                    <strong>{formatNumber(selected.session.totalTokens)}</strong>
                    <small>
                      {formatNumber(selected.session.inputTokens)} in · {formatNumber(selected.session.outputTokens)} out
                    </small>
                  </div>
                  <div className="metric-block">
                    <span>Subagents</span>
                    <strong>{selected.subagents.length}</strong>
                    <small>{selected.session.parentSessionId ? "child session" : "root session"}</small>
                  </div>
                </div>

                <div className="detail-grid">
                  <article className="subpanel">
                    <div className="panel-heading">
                      <h3>Tool usage breakdown</h3>
                    </div>
                    <div className="mini-list">
                      {selected.toolBreakdown.map((item) => (
                        <div key={item.toolName} className="mini-row">
                          <strong>{item.toolName}</strong>
                          <span>{item.count}</span>
                        </div>
                      ))}
                      {!selected.toolBreakdown.length ? <p className="empty">No tool calls.</p> : null}
                    </div>
                  </article>

                  <article className="subpanel">
                    <div className="panel-heading">
                      <h3>Subagents</h3>
                    </div>
                    <div className="mini-list">
                      {selected.subagents.map((subagent) => (
                        <div key={subagent.id} className="mini-row tall">
                          <div>
                            <strong>{subagent.id}</strong>
                            <span>{subagent.source}</span>
                          </div>
                          <div>
                            <span className={`pill ${phaseTone(subagent.phase)}`}>{subagent.phase.replace("_", " ")}</span>
                            <span>{formatNumber(subagent.totalTokens)} tokens</span>
                          </div>
                        </div>
                      ))}
                      {!selected.subagents.length ? <p className="empty">No child sessions.</p> : null}
                    </div>
                  </article>
                </div>

                <div className="detail-grid double">
                  <section className="subpanel">
                    <div className="panel-heading">
                      <h3>Timeline</h3>
                      <span>{selected?.timeline.length ?? 0}</span>
                    </div>
                    <div className="timeline-list">
                      {selected?.timeline.map((item) => (
                        <div key={item.id} className="timeline-row">
                          <div className={`timeline-dot ${activityTone(item.kind === "approval" ? "warn" : item.kind === "tool_result" ? "good" : "neutral")}`} />
                          <div>
                            <div className="timeline-head">
                              <strong>{item.label}</strong>
                              <span>{formatDate(item.timestamp)}</span>
                            </div>
                            <p>{item.detail}</p>
                          </div>
                        </div>
                      ))}
                      {!selected?.timeline.length ? <p className="empty">No timeline.</p> : null}
                    </div>
                  </section>

                  <section className="subpanel">
                    <div className="panel-heading">
                      <h3>Tool execution history</h3>
                      <span>{selected?.toolTimeline.length ?? 0}</span>
                    </div>
                    <div className="mini-list">
                      {selected?.toolTimeline.map((item) => (
                        <div key={item.id} className="mini-row tall">
                          <div>
                            <strong>{item.toolName}</strong>
                            <span>{item.detail}</span>
                          </div>
                          <div>
                            <span className={`pill ${item.outcome === "error" ? "bad" : item.outcome === "ok" ? "good" : "warn"}`}>
                              {item.outcome}
                            </span>
                            <span>{formatDate(item.timestamp)}</span>
                          </div>
                        </div>
                      ))}
                      {!selected?.toolTimeline.length ? <p className="empty">No tool history.</p> : null}
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <p className="empty">No session selected.</p>
            )}
          </div>
        </section>
      </section>

      <section className="bottom-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Activity feed</h2>
            <span>{data.activityFeed.length}</span>
          </div>
          <div className="feed-list">
            {data.activityFeed.map((item) => (
              <div key={item.id} className="feed-row">
                <span className={`pill ${activityTone(item.tone)}`}>{item.type.replace("_", " ")}</span>
                <div>
                  <div className="timeline-head">
                    <strong>{item.label}</strong>
                    <span>{formatDate(item.timestamp)}</span>
                  </div>
                  <p>{item.detail}</p>
                  <small>{item.sessionId}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Gateway and load</h2>
          </div>
          <div className="mini-list">
            <div className="mini-row">
              <strong>Gateway pid</strong>
              <span>{data.gateway?.pid ?? "N/A"}</span>
            </div>
            {Object.entries(data.gateway?.platforms ?? {}).map(([name, platform]) => (
              <div key={name} className="mini-row tall">
                <div>
                  <strong>{name}</strong>
                  <span>{formatDate(platform.updated_at)}</span>
                </div>
                <span className={`pill ${platform.state === "connected" ? "good" : "warn"}`}>{platform.state ?? "unknown"}</span>
              </div>
            ))}
            <div className="section-divider" />
            {data.platformBreakdown.map((item) => (
              <div key={item.source} className="mini-row">
                <strong>{item.source}</strong>
                <span>
                  {item.sessions} sessions · {formatNumber(item.totalTokens)} tokens
                </span>
              </div>
            ))}
            <div className="section-divider" />
            {data.cronJobs.slice(0, 6).map((job) => (
              <div key={job.id} className="mini-row tall">
                <div>
                  <strong>{job.name}</strong>
                  <span>{job.schedule_display ?? "N/A"}</span>
                </div>
                <span className={`pill ${job.last_status === "error" ? "bad" : "subtle"}`}>{job.last_status ?? "unknown"}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
