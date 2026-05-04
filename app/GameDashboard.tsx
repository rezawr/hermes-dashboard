"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { DashboardData, SessionPhase } from "../lib/hermes";
import styles from "./game-dashboard.module.css";

type CronJob = DashboardData["cronJobs"][number];
type CronRun = DashboardData["cronRuns"][number];
type SessionSummary = DashboardData["sessions"][number];
type WorkerState = "working" | "blocked" | "finished" | "waiting" | "sleeping";
type PlayerDirection = "playerDown" | "playerUp" | "playerLeft" | "playerRight";
type SceneId = "town" | "cronHouse" | "conversationHouse";
type TalkMessage = { speaker: "you" | "hermes"; text: string };
type SelectedTarget =
  | { kind: "gateway"; id: "gateway" }
  | { kind: "newCronJob"; id: "new-cron-job" }
  | { kind: "worker"; id: string }
  | { kind: "session"; id: string };

type WorkerEntity = {
  job: CronJob;
  state: WorkerState;
  slot: { x: number; y: number };
  latestRun: CronRun | null;
};

type SessionEntity = {
  session: SessionSummary;
  slot: { x: number; y: number };
};

type WorldEntity = {
  key: string;
  label: string;
  prompt: string;
  slot: { x: number; y: number };
  action:
    | { type: "inspect"; target: SelectedTarget }
    | { type: "travel"; scene: SceneId; spawn: { x: number; y: number }; direction: PlayerDirection };
};

const GATEWAY_SLOT = { x: 50, y: 67 };
const PLAYER_START = { x: 50, y: 78 };
const POLL_INTERVAL_MS = 120_000;
const SCENE_SPAWNS: Record<SceneId, { x: number; y: number; direction: PlayerDirection }> = {
  town: { x: 50, y: 78, direction: "playerUp" },
  cronHouse: { x: 50, y: 79, direction: "playerUp" },
  conversationHouse: { x: 50, y: 79, direction: "playerUp" },
};
const MOVE_STEP = 4;
const INTERACTION_RADIUS = 13;

const WORKER_SLOTS = [
  { x: 19, y: 24 },
  { x: 39, y: 22 },
  { x: 61, y: 24 },
  { x: 78, y: 39 },
  { x: 64, y: 57 },
  { x: 43, y: 63 },
  { x: 24, y: 55 },
  { x: 20, y: 77 },
  { x: 49, y: 79 },
  { x: 78, y: 74 },
  { x: 87, y: 19 },
  { x: 9, y: 39 },
];

const SESSION_SLOTS = [
  { x: 31, y: 38 },
  { x: 50, y: 34 },
  { x: 69, y: 38 },
  { x: 38, y: 58 },
  { x: 62, y: 58 },
];

const CRON_ROOM_SLOTS = [
  { x: 25, y: 40 },
  { x: 42, y: 35 },
  { x: 59, y: 35 },
  { x: 76, y: 40 },
  { x: 28, y: 60 },
  { x: 45, y: 58 },
  { x: 62, y: 58 },
  { x: 79, y: 60 },
  { x: 35, y: 75 },
  { x: 55, y: 75 },
  { x: 22, y: 75 },
  { x: 70, y: 75 },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | number | null | undefined, timezone: string) {
  if (value === null || value === undefined) return "N/A";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function relativeTime(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "Not scheduled";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  for (const [unit, size] of units) {
    if (absMs >= size) {
      return rtf.format(Math.round(diffMs / size), unit);
    }
  }

  return diffMs >= 0 ? "soon" : "just now";
}

function shortId(value: string, size = 10) {
  if (value.length <= size) return value;
  return `${value.slice(0, size)}...`;
}

function includesAny(value: string, pattern: RegExp) {
  return pattern.test(value.toLowerCase());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getWorkerState(job: CronJob): WorkerState {
  const stateText = `${job.state ?? ""} ${job.last_status ?? ""}`;

  if (job.enabled === false) return "sleeping";
  if (includesAny(stateText, /error|fail|timeout|blocked/)) return "blocked";
  if (includesAny(stateText, /running|processing|active|working|started/)) return "working";
  if (includesAny(stateText, /ok|success|complete|done|finished/)) return "finished";
  return job.enabled ? "waiting" : "sleeping";
}

function cronDisplayName(job: CronJob) {
  return job.name || `Worker ${shortId(job.id, 6)}`;
}

function plainWorkerStatus(state: WorkerState) {
  if (state === "working") return "is working right now";
  if (state === "blocked") return "needs your help";
  if (state === "finished") return "finished its last job";
  if (state === "sleeping") return "is switched off";
  return "is waiting for wake time";
}

function workerStateLabel(state: WorkerState) {
  if (state === "working") return "Working now";
  if (state === "blocked") return "Needs help";
  if (state === "finished") return "Finished";
  if (state === "sleeping") return "Paused";
  return "Waiting";
}

function workerStateCopy(state: WorkerState) {
  if (state === "working") return "This scheduled worker is awake and doing its job now.";
  if (state === "blocked") return "The last run looks unhealthy. Open the run note before trusting the output.";
  if (state === "finished") return "The last run finished cleanly and the worker is waiting for the next wake time.";
  if (state === "sleeping") return "This worker is turned off, so it will not wake up on its schedule.";
  return "This worker is quiet until the next scheduled wake time.";
}

function sessionPhaseLabel(phase: SessionPhase) {
  if (phase === "processing") return "Thinking";
  if (phase === "needs_approval") return "Needs approval";
  if (phase === "awaiting_input") return "Waiting for you";
  return "Idle";
}

function phaseTone(phase: SessionPhase) {
  if (phase === "processing") return "working";
  if (phase === "needs_approval") return "blocked";
  if (phase === "awaiting_input") return "waiting";
  return "finished";
}

function sceneLabel(scene: SceneId) {
  if (scene === "cronHouse") return "Cron House";
  if (scene === "conversationHouse") return "Conversation House";
  return "Hermes Town";
}

function getLatestRun(job: CronJob, runs: CronRun[]) {
  return (
    runs.find((run) => run.jobName === job.name || ("jobId" in run && run.jobId === job.id)) ??
    null
  );
}

function makeEntityKey(target: SelectedTarget) {
  return `${target.kind}:${target.id}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: WorkerState; children: React.ReactNode }) {
  return <span className={`${styles.statusBadge} ${styles[tone]}`}>{children}</span>;
}

function EmptyWorld() {
  return (
    <div className={styles.emptyWorld}>
      <div className={styles.emptyMachine} />
      <strong>No scheduled workers yet</strong>
      <span>Add a Hermes cron job and it will appear on this map.</span>
    </div>
  );
}

function WorkerSprite({ state }: { state: WorkerState }) {
  return (
    <span className={styles.sprite} aria-hidden="true">
      <span className={styles.spriteShadow} />
      <span className={styles.spriteBody}>
        <span className={styles.spriteEyeLeft} />
        <span className={styles.spriteEyeRight} />
        <span className={styles.spritePanel} />
      </span>
      <span className={`${styles.stateSpark} ${styles[state]}`} />
    </span>
  );
}

function SessionSprite({ phase }: { phase: SessionPhase }) {
  return (
    <span className={styles.sprite} aria-hidden="true">
      <span className={styles.spriteShadow} />
      <span className={styles.sessionBody}>
        <span />
        <span />
        <span />
      </span>
      <span className={`${styles.stateSpark} ${styles[phaseTone(phase)]}`} />
    </span>
  );
}

function GatewaySprite({ state }: { state: string }) {
  const online = /running|connected|ready|ok/i.test(state);

  return (
    <span className={styles.sprite} aria-hidden="true">
      <span className={styles.spriteShadow} />
      <span className={styles.gatewayCore}>
        <span className={online ? styles.gatewayLightOn : styles.gatewayLightOff} />
      </span>
    </span>
  );
}

function AddCronSprite() {
  return (
    <span className={styles.sprite} aria-hidden="true">
      <span className={styles.spriteShadow} />
      <span className={styles.addCronBody}>
        <span className={styles.addCronPlus}>+</span>
      </span>
      <span className={`${styles.stateSpark} ${styles.waiting}`} />
    </span>
  );
}

function PlayerCharacter({ direction, walking }: { direction: PlayerDirection; walking: boolean }) {
  return (
    <span className={`${styles.playerCharacter} ${styles[direction]} ${walking ? styles.playerWalking : ""}`}>
      <span className={styles.playerShadow} />
      <span className={styles.playerFigure} aria-hidden="true">
        <span className={styles.playerHead}>
          <span className={styles.playerHair} />
          <span className={styles.playerEyeLeft} />
          <span className={styles.playerEyeRight} />
        </span>
        <span className={styles.playerBody}>
          <span className={styles.playerPack} />
        </span>
        <span className={styles.playerLegs}>
          <span />
          <span />
        </span>
      </span>
      <span className={styles.playerName}>You</span>
    </span>
  );
}

type DashboardPollResponse = {
  ok?: boolean;
  data?: DashboardData;
  error?: string;
};

function GameDashboard({ data: initialData, timezone }: { data: DashboardData; timezone: string }) {
  const [data, setData] = useState(initialData);
  const [lastCheckedAt, setLastCheckedAt] = useState(initialData.generatedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>({
    kind: "gateway",
    id: "gateway",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [conversationTarget, setConversationTarget] = useState("gateway:gateway");
  const [messageDraft, setMessageDraft] = useState("");
  const [talkMessages, setTalkMessages] = useState<TalkMessage[]>([]);
  const [talkBusy, setTalkBusy] = useState(false);
  const [talkSessionId, setTalkSessionId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerSchedule, setNewWorkerSchedule] = useState("");
  const [newWorkerTask, setNewWorkerTask] = useState("");
  const [newWorkerBusy, setNewWorkerBusy] = useState(false);
  const [currentScene, setCurrentScene] = useState<SceneId>("town");
  const [player, setPlayer] = useState(PLAYER_START);
  const [playerDirection, setPlayerDirection] = useState<PlayerDirection>("playerDown");
  const [playerWalking, setPlayerWalking] = useState(false);

  const refreshDashboard = useCallback(async () => {
    if (refreshInFlight.current) return;

    refreshInFlight.current = true;
    setRefreshing(true);

    try {
      const response = await fetch("/api/hermes/dashboard", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as DashboardPollResponse;

      if (!response.ok || !result.ok || !result.data) {
        throw new Error(result.error ?? "The town could not check Hermes.");
      }

      setData(result.data);
      setLastCheckedAt(result.data.generatedAt);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "The town could not check Hermes.");
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setData(initialData);
    setLastCheckedAt(initialData.generatedAt);
  }, [initialData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshDashboard();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refreshDashboard]);

  const workers = useMemo<WorkerEntity[]>(
    () =>
      data.cronJobs.slice(0, WORKER_SLOTS.length).map((job, index) => ({
        job,
        state: getWorkerState(job),
        slot: WORKER_SLOTS[index],
        latestRun: getLatestRun(job, data.cronRuns),
      })),
    [data.cronJobs, data.cronRuns],
  );

  const sessions = useMemo<SessionEntity[]>(
    () =>
      data.sessions.slice(0, SESSION_SLOTS.length).map((session, index) => ({
        session,
        slot: SESSION_SLOTS[index],
      })),
    [data.sessions],
  );

  const worldEntities = useMemo<WorldEntity[]>(() => {
    if (currentScene === "town") {
      return [
        {
          key: "door:cron-house",
          label: "Cron House",
          prompt: "Enter Cron House",
          slot: { x: 32, y: 47 },
          action: {
            type: "travel",
            scene: "cronHouse",
            spawn: { x: SCENE_SPAWNS.cronHouse.x, y: SCENE_SPAWNS.cronHouse.y },
            direction: SCENE_SPAWNS.cronHouse.direction,
          },
        },
        {
          key: "door:conversation-house",
          label: "Conversation House",
          prompt: "Enter Conversation House",
          slot: { x: 68, y: 47 },
          action: {
            type: "travel",
            scene: "conversationHouse",
            spawn: { x: SCENE_SPAWNS.conversationHouse.x, y: SCENE_SPAWNS.conversationHouse.y },
            direction: SCENE_SPAWNS.conversationHouse.direction,
          },
        },
        {
          key: "gateway:gateway",
          label: "Hermes station",
          prompt: "Inspect Hermes station",
          slot: GATEWAY_SLOT,
          action: { type: "inspect", target: { kind: "gateway", id: "gateway" } },
        },
      ];
    }

    if (currentScene === "cronHouse") {
      const workerEntities: WorldEntity[] = workers.slice(0, CRON_ROOM_SLOTS.length).map((worker, index) => ({
        key: makeEntityKey({ kind: "worker", id: worker.job.id }),
        label: cronDisplayName(worker.job),
        prompt: `Talk to ${cronDisplayName(worker.job)}`,
        slot: CRON_ROOM_SLOTS[index],
        action: { type: "inspect", target: { kind: "worker", id: worker.job.id } },
      }));

      return [
        {
          key: "door:cron-exit",
          label: "Town door",
          prompt: "Leave Cron House",
          slot: { x: 50, y: 89 },
          action: {
            type: "travel",
            scene: "town",
            spawn: { x: 32, y: 57 },
            direction: "playerDown",
          },
        },
        ...workerEntities,
        {
          key: "new-cron-job",
          label: "Builder",
          prompt: "Create a new cron job",
          slot: { x: 88, y: 78 },
          action: { type: "inspect", target: { kind: "newCronJob", id: "new-cron-job" } },
        },
      ];
    }

    const sessionEntities: WorldEntity[] = sessions.map((item) => ({
      key: makeEntityKey({ kind: "session", id: item.session.id }),
      label: item.session.title || shortId(item.session.id, 12),
      prompt: `Inspect ${item.session.title || shortId(item.session.id, 12)}`,
      action: { type: "inspect", target: { kind: "session", id: item.session.id } },
      slot: item.slot,
    }));

    return [
      {
        key: "door:conversation-exit",
        label: "Town door",
        prompt: "Leave Conversation House",
        slot: { x: 50, y: 89 },
        action: {
          type: "travel",
          scene: "town",
          spawn: { x: 68, y: 57 },
          direction: "playerDown",
        },
      },
      ...sessionEntities,
    ];
  }, [currentScene, sessions, workers]);

  const nearbyEntity = useMemo(() => {
    const sorted = worldEntities
      .map((entity) => ({ ...entity, distance: distance(player, entity.slot) }))
      .filter((entity) => entity.distance <= INTERACTION_RADIUS)
      .sort((a, b) => a.distance - b.distance);

    return sorted[0] ?? null;
  }, [player, worldEntities]);

  const defaultTarget = useMemo<SelectedTarget>(() => {
    const blockedWorker = workers.find((worker) => worker.state === "blocked");
    if (blockedWorker) return { kind: "worker", id: blockedWorker.job.id };
    if (workers[0]) return { kind: "worker", id: workers[0].job.id };
    if (sessions[0]) return { kind: "session", id: sessions[0].session.id };
    return { kind: "gateway", id: "gateway" };
  }, [workers, sessions]);

  const activeTarget = useMemo<SelectedTarget>(() => {
    if (selectedTarget.kind === "worker" && workers.some((worker) => worker.job.id === selectedTarget.id)) {
      return selectedTarget;
    }
    if (selectedTarget.kind === "session" && sessions.some((session) => session.session.id === selectedTarget.id)) {
      return selectedTarget;
    }
    if (selectedTarget.kind === "newCronJob") return selectedTarget;
    if (selectedTarget.kind === "gateway") return selectedTarget;
    return defaultTarget;
  }, [defaultTarget, selectedTarget, sessions, workers]);

  const selectedWorker =
    activeTarget.kind === "worker" ? workers.find((worker) => worker.job.id === activeTarget.id) ?? null : null;
  const selectedSession =
    activeTarget.kind === "session"
      ? sessions.find((item) => item.session.id === activeTarget.id)?.session ?? null
      : null;
  const selectedSessionDetail = selectedSession ? data.sessionDetails[selectedSession.id] : null;
  const selectedNewCronJob = activeTarget.kind === "newCronJob";

  useEffect(() => {
    if (!dialogOpen) return;

    const timer = window.setTimeout(() => {
      const focusTarget = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-focus]");
      focusTarget?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeTarget.id, activeTarget.kind, dialogOpen]);

  function chooseTarget(target: SelectedTarget) {
    setSelectedTarget(target);
    setConversationTarget(makeEntityKey(target));
  }

  function openTarget(target: SelectedTarget) {
    chooseTarget(target);
    setDialogOpen(true);
  }

  function activateEntity(entity: WorldEntity) {
    if (entity.action.type === "travel") {
      setCurrentScene(entity.action.scene);
      setPlayer(entity.action.spawn);
      setPlayerDirection(entity.action.direction);
      setPlayerWalking(false);
      setDialogOpen(false);
      return;
    }
    openTarget(entity.action.target);
  }

  function interactNearby() {
    if (!nearbyEntity) return;
    activateEntity(nearbyEntity);
  }

  function movePlayer(deltaX: number, deltaY: number, direction: PlayerDirection) {
    setPlayerDirection(direction);
    setPlayerWalking(true);
    setPlayer((current) => ({
      x: clamp(current.x + deltaX, 5, 95),
      y: clamp(current.y + deltaY, 10, 92),
    }));
  }

  useEffect(() => {
    if (!playerWalking) return;
    const timer = window.setTimeout(() => setPlayerWalking(false), 150);
    return () => window.clearTimeout(timer);
  }, [player, playerWalking]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dialogOpen) {
        event.preventDefault();
        setDialogOpen(false);
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (dialogOpen) return;

      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        event.preventDefault();
        movePlayer(0, -MOVE_STEP, "playerUp");
      } else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        movePlayer(0, MOVE_STEP, "playerDown");
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        movePlayer(-MOVE_STEP, 0, "playerLeft");
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        movePlayer(MOVE_STEP, 0, "playerRight");
      } else if (event.key === "Enter" || event.key.toLowerCase() === "e" || event.key === " ") {
        if (nearbyEntity) {
          event.preventDefault();
          interactNearby();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, nearbyEntity]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!text) return;

    setTalkBusy(true);
    setMessageDraft("");
    setTalkMessages((current) => [...current.slice(-5), { speaker: "you", text }]);

    try {
      const response = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          target: conversationTarget,
          sessionId: talkSessionId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setTalkMessages((current) => [
          ...current.slice(-5),
          {
            speaker: "hermes",
            text: result.error ?? "Hermes did not answer.",
          },
        ]);
      } else {
        setTalkSessionId(result.sessionId ?? talkSessionId);
        setTalkMessages((current) => [
          ...current.slice(-5),
          { speaker: "hermes", text: result.reply ?? "Hermes answered." },
        ]);
      }
    } finally {
      setTalkBusy(false);
    }
  }

  async function createWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkerName.trim();
    const schedule = newWorkerSchedule.trim();
    const prompt = newWorkerTask.trim();
    if (!name || !schedule || !prompt) {
      setActionNote("The builder needs a name, wake time, and job.");
      return;
    }

    setNewWorkerBusy(true);
    setActionNote(null);
    try {
      const response = await fetch("/api/hermes/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, schedule, prompt, deliver: "local" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setActionNote(result.error ?? "The builder could not create that worker.");
      } else {
        setActionNote("New worker created. The town is checking for it now.");
        setNewWorkerName("");
        setNewWorkerSchedule("");
        setNewWorkerTask("");
        void refreshDashboard();
      }
    } finally {
      setNewWorkerBusy(false);
    }
  }

  async function wakeWorker(jobId: string) {
    setActionNote("Trying to wake this worker now...");
    const response = await fetch(`/api/hermes/cron/${encodeURIComponent(jobId)}/run`, {
      method: "POST",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      setActionNote(result.error ?? "This worker could not be woken now.");
    } else {
      setActionNote("Worker is waking up. The town checks again by itself every 2 minutes.");
      void refreshDashboard();
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.worldLayout}>
        <section className={styles.worldPanel} aria-label="Operations map">
          <div
            className={`${styles.worldMap} ${styles[currentScene]}`}
            tabIndex={0}
            aria-label={`${sceneLabel(currentScene)} map`}
          >
            <div className={styles.worldTopline}>
              <div>
                <span>Hermes Town</span>
                <strong>{sceneLabel(currentScene)}</strong>
              </div>
              <div className={styles.worldCounters}>
                <span>{data.summary.gatewayState === "running" ? "Hermes awake" : "Hermes quiet"}</span>
                <span>{data.summary.totalCronJobs} workers</span>
                <span>{data.sessions.length} chats</span>
                <span
                  className={refreshError ? styles.refreshProblem : undefined}
                  title={refreshError ?? "Hermes Town checks for updates every 2 minutes."}
                >
                  {refreshError ? "Check missed" : refreshing ? "Checking" : `Checked ${relativeTime(lastCheckedAt)}`}
                </span>
              </div>
            </div>

            {currentScene === "town" ? (
              <>
                <div className={styles.tileLayer} aria-hidden="true" />
                <div className={`${styles.mapFeature} ${styles.water}`} aria-hidden="true" />
                <div className={`${styles.mapFeature} ${styles.field}`} aria-hidden="true" />
                <div className={`${styles.mapFeature} ${styles.forest}`} aria-hidden="true" />
                <div className={`${styles.path} ${styles.pathMain}`} aria-hidden="true" />
                <div className={`${styles.path} ${styles.pathBranchA}`} aria-hidden="true" />
                <div className={`${styles.path} ${styles.pathBranchB}`} aria-hidden="true" />
                <div className={`${styles.houseBuilding} ${styles.cronHouseBuilding}`} aria-hidden="true">
                  <span>Cron</span>
                  <i />
                </div>
                <div className={`${styles.houseBuilding} ${styles.conversationHouseBuilding}`} aria-hidden="true">
                  <span>Convo</span>
                  <i />
                </div>
                <button
                  type="button"
                  className={`${styles.entityButton} ${styles.gatewayEntity} ${
                    activeTarget.kind === "gateway" ? styles.selectedEntity : ""
                  } ${nearbyEntity?.key === "gateway:gateway" ? styles.nearbyEntity : ""}`}
                  style={{ left: `${GATEWAY_SLOT.x}%`, top: `${GATEWAY_SLOT.y}%` }}
                  onClick={() => openTarget({ kind: "gateway", id: "gateway" })}
                  title="Open Hermes gateway"
                >
                  <GatewaySprite state={data.summary.gatewayState} />
                  <span className={styles.entityName}>Hermes</span>
                  <small>{data.summary.gatewayState}</small>
                </button>
              </>
            ) : (
              <>
                <div className={styles.roomFloor} aria-hidden="true" />
                <div className={styles.roomWall} aria-hidden="true" />
                <div className={styles.roomRug} aria-hidden="true" />
                <div className={styles.counterDesk} aria-hidden="true" />
                <div className={styles.roomSign} aria-hidden="true">
                  {currentScene === "cronHouse" ? "Cron House" : "Conversation House"}
                </div>
              </>
            )}

            {worldEntities
              .filter((entity) => entity.action.type === "travel")
              .map((entity) => (
                <button
                  key={entity.key}
                  type="button"
                  className={`${styles.doorEntity} ${entity.action.type === "travel" && entity.action.scene === "town" ? styles.exitDoor : ""} ${
                    nearbyEntity?.key === entity.key ? styles.nearbyEntity : ""
                  }`}
                  style={{ left: `${entity.slot.x}%`, top: `${entity.slot.y}%` }}
                  onClick={() => activateEntity(entity)}
                  title={entity.prompt}
                >
                  <span>{entity.action.type === "travel" && entity.action.scene === "town" ? "Exit" : "Door"}</span>
                  <small>{entity.label}</small>
                </button>
              ))}

            {currentScene === "cronHouse" ? (
              <>
                {worldEntities
                  .filter((entity) => entity.action.type === "inspect" && entity.action.target.kind === "worker")
                  .map((entity) => {
                    const target = entity.action.type === "inspect" ? entity.action.target : null;
                    const worker = target?.kind === "worker" ? workers.find((item) => item.job.id === target.id) : null;
                    if (!worker) return null;
                    const selected = activeTarget.kind === "worker" && activeTarget.id === worker.job.id;
                    return (
                      <button
                        key={entity.key}
                        type="button"
                        className={`${styles.entityButton} ${styles.workerEntity} ${styles.npcEntity} ${
                          styles[worker.state]
                        } ${selected ? styles.selectedEntity : ""} ${
                          nearbyEntity?.key === entity.key ? styles.nearbyEntity : ""
                        }`}
                        style={{ left: `${entity.slot.x}%`, top: `${entity.slot.y}%` }}
                        onClick={() => activateEntity(entity)}
                        title={entity.prompt}
                      >
                        <WorkerSprite state={worker.state} />
                        <span className={styles.entityName}>{entity.label}</span>
                        <small>{plainWorkerStatus(worker.state)}</small>
                      </button>
                    );
                  })}
                {worldEntities
                  .filter((entity) => entity.key === "new-cron-job")
                  .map((entity) => (
                    <button
                      key={entity.key}
                      type="button"
                      className={`${styles.entityButton} ${styles.npcEntity} ${styles.addCronEntity} ${
                        selectedNewCronJob ? styles.selectedEntity : ""
                      } ${nearbyEntity?.key === entity.key ? styles.nearbyEntity : ""}`}
                      style={{ left: `${entity.slot.x}%`, top: `${entity.slot.y}%` }}
                      onClick={() => activateEntity(entity)}
                      title={entity.prompt}
                    >
                      <AddCronSprite />
                      <span className={styles.entityName}>{entity.label}</span>
                      <small>Add job</small>
                    </button>
                  ))}
              </>
            ) : null}

            {currentScene === "conversationHouse"
              ? sessions.map((item) => {
                  const selected = activeTarget.kind === "session" && activeTarget.id === item.session.id;
                  return (
                    <button
                      key={item.session.id}
                      type="button"
                      className={`${styles.entityButton} ${styles.sessionEntity} ${styles.npcEntity} ${
                        styles[phaseTone(item.session.phase)]
                      } ${selected ? styles.selectedEntity : ""} ${
                        nearbyEntity?.key === makeEntityKey({ kind: "session", id: item.session.id })
                          ? styles.nearbyEntity
                          : ""
                      }`}
                      style={{ left: `${item.slot.x}%`, top: `${item.slot.y}%` }}
                      onClick={() => openTarget({ kind: "session", id: item.session.id })}
                      title={`Open ${item.session.title || item.session.id}`}
                    >
                      <SessionSprite phase={item.session.phase} />
                      <span className={styles.entityName}>{item.session.title || shortId(item.session.id)}</span>
                      <small>{sessionPhaseLabel(item.session.phase)}</small>
                    </button>
                  );
                })
              : null}

            <div className={styles.playerLayer} style={{ left: `${player.x}%`, top: `${player.y}%` }}>
              <PlayerCharacter direction={playerDirection} walking={playerWalking} />
            </div>

            {nearbyEntity && !dialogOpen ? (
              <button
                type="button"
                className={styles.interactionPrompt}
                style={{ left: `${player.x}%`, top: `${clamp(player.y - 13, 5, 86)}%` }}
                onClick={interactNearby}
              >
                {nearbyEntity.prompt}
              </button>
            ) : null}

            <div className={`${styles.dpad} ${dialogOpen ? styles.dpadHidden : ""}`} aria-label="Movement controls">
              <button type="button" className={styles.dpadUp} onClick={() => movePlayer(0, -MOVE_STEP, "playerUp")} aria-label="Move up">
                ↑
              </button>
              <button type="button" className={styles.dpadLeft} onClick={() => movePlayer(-MOVE_STEP, 0, "playerLeft")} aria-label="Move left">
                ←
              </button>
              <button type="button" className={styles.dpadRight} onClick={() => movePlayer(MOVE_STEP, 0, "playerRight")} aria-label="Move right">
                →
              </button>
              <button type="button" className={styles.dpadDown} onClick={() => movePlayer(0, MOVE_STEP, "playerDown")} aria-label="Move down">
                ↓
              </button>
              <button type="button" className={styles.actionButton} onClick={interactNearby} disabled={!nearbyEntity} aria-label="Inspect nearby entity">
                A
              </button>
            </div>

            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <i className={styles.working} />
                Working
              </span>
              <span className={styles.legendItem}>
                <i className={styles.waiting} />
                Waiting
              </span>
              <span className={styles.legendItem}>
                <i className={styles.finished} />
                Finished
              </span>
              <span className={styles.legendItem}>
                <i className={styles.blocked} />
                Needs help
              </span>
              <span className={styles.legendItem}>
                <i className={styles.sleeping} />
                Paused
              </span>
            </div>

            {dialogOpen ? (
              <div ref={dialogRef} className={styles.dialogLayer} role="dialog" aria-label="Action dialog">
                <button
                  type="button"
                  className={styles.dialogClose}
                  onClick={() => setDialogOpen(false)}
                  aria-label="Close dialog"
                >
                  B
                </button>
                {selectedWorker ? (
                  <WorkerInspector worker={selectedWorker} timezone={timezone} actionNote={actionNote} onWake={wakeWorker} />
                ) : selectedSession ? (
                  <SessionInspector
                    session={selectedSession}
                    detail={selectedSessionDetail}
                    timezone={timezone}
                    messages={talkMessages}
                    draft={messageDraft}
                    busy={talkBusy}
                    onDraftChange={setMessageDraft}
                    onSubmit={submitPrompt}
                  />
                ) : selectedNewCronJob ? (
                  <NewCronJobInspector
                    name={newWorkerName}
                    schedule={newWorkerSchedule}
                    task={newWorkerTask}
                    busy={newWorkerBusy}
                    actionNote={actionNote}
                    onNameChange={setNewWorkerName}
                    onScheduleChange={setNewWorkerSchedule}
                    onTaskChange={setNewWorkerTask}
                    onSubmit={createWorker}
                  />
                ) : (
                  <GatewayInspector
                    data={data}
                    messages={talkMessages}
                    draft={messageDraft}
                    busy={talkBusy}
                    onDraftChange={setMessageDraft}
                    onSubmit={submitPrompt}
                  />
                )}
              </div>
            ) : null}

            {currentScene === "town" && !workers.length && !sessions.length ? <EmptyWorld /> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function WorkerInspector({
  worker,
  timezone,
  actionNote,
  onWake,
}: {
  worker: WorkerEntity;
  timezone: string;
  actionNote: string | null;
  onWake: (jobId: string) => void;
}) {
  const job = worker.job;
  const run = worker.latestRun;
  const style = { "--meter": `${worker.state === "blocked" ? 100 : worker.state === "working" ? 68 : 34}%` } as CSSProperties;

  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorTitle}>
        <span>Worker</span>
        <h2>{cronDisplayName(job)}</h2>
        <StatusBadge tone={worker.state}>{workerStateLabel(worker.state)}</StatusBadge>
      </div>

      <p className={styles.inspectorCopy}>{workerStateCopy(worker.state)}</p>
      <div className={styles.energyMeter} style={style}>
        <span />
      </div>

      <div className={styles.detailGrid}>
        <DetailRow label="Wakes up" value={job.schedule_display ?? "No wake time set"} />
        <DetailRow label="Next wake" value={relativeTime(job.next_run_at)} />
        <DetailRow label="Last woke" value={formatDate(job.last_run_at, timezone)} />
        <DetailRow label="Mood" value={plainWorkerStatus(worker.state)} />
      </div>

      <section className={styles.noteBlock}>
        <span>Last note</span>
        {run ? (
          <>
            <strong>{run.status === "ok" ? "It finished cleanly" : "It had trouble"}</strong>
            <p>{run.excerpt || "Run finished without a written note."}</p>
          </>
        ) : (
          <p>This worker has not left a note yet.</p>
        )}
      </section>

      <button type="button" data-dialog-focus className={styles.primaryAction} onClick={() => onWake(job.id)}>
        Wake this worker now
      </button>
      {actionNote ? <p className={styles.actionNote}>{actionNote}</p> : null}
    </div>
  );
}

function SessionInspector({
  session,
  detail,
  timezone,
  messages,
  draft,
  busy,
  onDraftChange,
  onSubmit,
}: {
  session: SessionSummary;
  detail: DashboardData["selectedSession"];
  timezone: string;
  messages: TalkMessage[];
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorTitle}>
        <span>Conversation friend</span>
        <h2>{session.title || shortId(session.id, 18)}</h2>
        <StatusBadge tone={phaseTone(session.phase)}>{sessionPhaseLabel(session.phase)}</StatusBadge>
      </div>

      <p className={styles.inspectorCopy}>
        {session.phase === "processing"
          ? "Hermes is thinking in this conversation."
          : session.phase === "needs_approval"
            ? "Hermes is waiting for someone to approve an action."
            : session.phase === "awaiting_input"
              ? "Hermes is waiting for your next message."
              : "This conversation is resting."}
      </p>

      <div className={styles.detailGrid}>
        <DetailRow label="Last talked" value={formatDate(session.lastActivityAt, timezone)} />
        <DetailRow label="Messages" value={formatNumber(session.messageCount)} />
      </div>

      <section className={styles.noteBlock}>
        <span>Recent story</span>
        <div className={styles.timelineMini}>
          {detail?.timeline.slice(-2).map((item) => (
            <article key={item.id}>
              <strong>{item.label}</strong>
              <p>{item.detail || "No detail recorded."}</p>
            </article>
          ))}
          {!detail?.timeline.length ? <p>No timeline recorded for this conversation.</p> : null}
        </div>
      </section>

      <TalkBox
        messages={messages}
        draft={draft}
        busy={busy}
        placeholder="Say something to Hermes..."
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}

function NewCronJobInspector({
  name,
  schedule,
  task,
  busy,
  actionNote,
  onNameChange,
  onScheduleChange,
  onTaskChange,
  onSubmit,
}: {
  name: string;
  schedule: string;
  task: string;
  busy: boolean;
  actionNote: string | null;
  onNameChange: (value: string) => void;
  onScheduleChange: (value: string) => void;
  onTaskChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorTitle}>
        <span>Cron House</span>
        <h2>Worker builder</h2>
        <StatusBadge tone="waiting">Ready</StatusBadge>
      </div>

      <p className={styles.inspectorCopy}>
        Create a helper that wakes up by itself, does one job, and leaves a note when it is done.
      </p>

      <form className={styles.npcForm} onSubmit={onSubmit}>
        <label>
          Worker name
          <input
            data-dialog-focus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Morning news helper"
          />
        </label>
        <label>
          Wake time
          <input
            value={schedule}
            onChange={(event) => onScheduleChange(event.target.value)}
            placeholder="every 2h or 0 8 * * *"
          />
        </label>
        <label>
          What should it do?
          <textarea
            value={task}
            onChange={(event) => onTaskChange(event.target.value)}
            placeholder="Check today's market news and write a short summary."
            rows={2}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Building..." : "Build worker"}
        </button>
      </form>
      {actionNote ? <p className={styles.actionNote}>{actionNote}</p> : null}
    </div>
  );
}

function GatewayInspector({
  data,
  messages,
  draft,
  busy,
  onDraftChange,
  onSubmit,
}: {
  data: DashboardData;
  messages: TalkMessage[];
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorTitle}>
        <span>Hermes station</span>
        <h2>Talk to Hermes</h2>
        <StatusBadge tone={/running|connected|ready|ok/i.test(data.summary.gatewayState) ? "finished" : "waiting"}>
          {data.summary.gatewayState === "running" ? "Awake" : "Quiet"}
        </StatusBadge>
      </div>

      <p className={styles.inspectorCopy}>
        This is the main place to ask Hermes for help. If Hermes does not answer, the station needs its API door opened.
      </p>

      <div className={styles.detailGrid}>
        <DetailRow label="Workers awake" value={`${data.summary.enabledCronJobs}/${data.summary.totalCronJobs}`} />
        <DetailRow label="Conversations" value={formatNumber(data.summary.totalSessions)} />
      </div>

      <TalkBox
        messages={messages}
        draft={draft}
        busy={busy}
        placeholder="Ask Hermes what needs attention..."
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}

function TalkBox({
  messages,
  draft,
  busy,
  placeholder,
  onDraftChange,
  onSubmit,
}: {
  messages: TalkMessage[];
  draft: string;
  busy: boolean;
  placeholder: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className={styles.talkBox}>
      <span>Talk</span>
      <div className={styles.talkMessages}>
        {messages.slice(-3).map((message, index) => (
          <p key={`${message.speaker}-${index}`} className={message.speaker === "you" ? styles.youBubble : styles.hermesBubble}>
            {message.text}
          </p>
        ))}
        {!messages.length ? <p className={styles.emptyLine}>Say something and Hermes will answer here.</p> : null}
      </div>
      <form onSubmit={onSubmit} className={styles.talkForm}>
        <textarea
          data-dialog-focus
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={placeholder}
          rows={2}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Waiting..." : "Send"}
        </button>
      </form>
    </section>
  );
}

export default GameDashboard;
