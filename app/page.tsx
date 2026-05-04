import GameDashboard from "./GameDashboard";
import { prepareGameData } from "../lib/game-data";
import { loadDashboardData } from "../lib/hermes";

export const dynamic = "force-dynamic";

const DASHBOARD_TIMEZONE = process.env.DASHBOARD_TIMEZONE ?? "UTC";

export default async function Home() {
  const data = await loadDashboardData();

  return <GameDashboard data={prepareGameData(data)} timezone={DASHBOARD_TIMEZONE} />;
}
