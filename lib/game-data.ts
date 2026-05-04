import type { DashboardData } from "./hermes";

type SessionDetail = NonNullable<DashboardData["selectedSession"]>;

function trimSessionDetail(detail: SessionDetail): SessionDetail {
  return {
    ...detail,
    toolTimeline: detail.toolTimeline.slice(0, 8),
    timeline: detail.timeline.slice(-8),
    toolBreakdown: detail.toolBreakdown.slice(0, 8),
    subagents: detail.subagents.slice(0, 6),
  };
}

export function prepareGameData(data: DashboardData): DashboardData {
  const visibleSessionIds = new Set(data.sessions.slice(0, 5).map((session) => session.id));

  return {
    ...data,
    cronRuns: data.cronRuns.slice(0, 12),
    activityFeed: data.activityFeed.slice(0, 12),
    selectedSession: null,
    sessionDetails: Object.fromEntries(
      Object.entries(data.sessionDetails)
        .filter(([sessionId]) => visibleSessionIds.has(sessionId))
        .map(([sessionId, detail]) => [sessionId, trimSessionDetail(detail)]),
    ),
  };
}
