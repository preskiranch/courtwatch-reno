"use client";

import type { DashboardResponse, Game, GameChangeEvent, ProgramSummary, Team } from "@courtwatch/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  Home,
  MapPin,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  ShieldAlert,
  Smartphone,
  Trophy,
  Users,
  WifiOff,
  X
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { CourtWatchApi, apiBaseUrl } from "../lib/api";
import { requestPushSubscription } from "../lib/push";

type Tab = "dashboard" | "schedule" | "teams" | "alerts" | "settings";

const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "teams", label: "Teams", icon: Users },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings }
];

export function CourtWatchApp() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [toast, setToast] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({ queryKey: ["dashboard"], queryFn: CourtWatchApi.dashboard });
  const gamesQuery = useQuery({ queryKey: ["games"], queryFn: () => CourtWatchApi.games() });
  const alertsQuery = useQuery({ queryKey: ["alerts"], queryFn: CourtWatchApi.alerts });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] })
    ]);
    setToast("Schedule refreshed");
    window.setTimeout(() => setToast(null), 2200);
  };

  const dashboard = dashboardQuery.data;
  const isLoading = dashboardQuery.isLoading;
  const offline = dashboardQuery.isError || gamesQuery.isError || alertsQuery.isError;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-24 pt-4 text-white sm:max-w-3xl md:max-w-5xl">
      <AppHeader dashboard={dashboard} offline={offline} onRefresh={refresh} refreshing={dashboardQuery.isFetching || gamesQuery.isFetching} />

      {toast ? (
        <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 rounded-lg border border-orange-300/50 bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      ) : null}

      <section className="mt-4 flex-1">
        {isLoading ? <SkeletonDashboard /> : null}
        {!isLoading && dashboard && activeTab === "dashboard" ? <DashboardScreen dashboard={dashboard} alerts={alertsQuery.data ?? []} onRefresh={refresh} /> : null}
        {!isLoading && dashboard && activeTab === "schedule" ? <ScheduleScreen games={gamesQuery.data ?? []} programs={dashboard.programs} /> : null}
        {!isLoading && dashboard && activeTab === "teams" ? <TeamsScreen dashboard={dashboard} /> : null}
        {!isLoading && dashboard && activeTab === "alerts" ? <AlertsScreen alerts={alertsQuery.data ?? dashboard.alerts} games={gamesQuery.data ?? []} /> : null}
        {!isLoading && dashboard && activeTab === "settings" ? <SettingsScreen dashboard={dashboard} onRefresh={refresh} /> : null}
      </section>

      <BottomTabs activeTab={activeTab} setActiveTab={setActiveTab} />
    </main>
  );
}

function AppHeader({
  dashboard,
  offline,
  onRefresh,
  refreshing
}: {
  dashboard?: DashboardResponse;
  offline: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#07111f]/92 px-4 pb-3 pt-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
            <Radio className="h-3.5 w-3.5" />
            Reno Memorial Day
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-normal text-white">CourtWatch Reno</h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="grid h-11 w-11 place-items-center rounded-lg border border-white/12 bg-white/8 text-white transition active:scale-95"
          aria-label="Refresh schedule"
        >
          <RefreshCcw className={clsx("h-5 w-5", refreshing && "animate-spin")} />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          {offline ? <WifiOff className="h-3.5 w-3.5 text-orange-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
          {offline ? "Offline cache" : dashboard?.sourceStatus.message ?? "Loading source"}
        </span>
        <span>{dashboard?.lastUpdated ? `Updated ${formatShortTime(dashboard.lastUpdated)}` : "Sync pending"}</span>
      </div>
    </header>
  );
}

function DashboardScreen({ dashboard, alerts, onRefresh }: { dashboard: DashboardResponse; alerts: GameChangeEvent[]; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <NextGameBanner game={dashboard.nextGame} />

      <button
        type="button"
        onClick={onRefresh}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/8 px-4 text-sm font-semibold text-slate-100 active:scale-[0.99]"
      >
        <RefreshCcw className="h-4 w-4" />
        Pull to refresh
      </button>

      <div className="grid gap-3 md:grid-cols-2">
        {dashboard.programs.map((program) => (
          <ProgramCard key={program.program.id} program={program} />
        ))}
      </div>

      <section className="court-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-950">Latest Alerts</h2>
          <span className="text-xs font-bold text-slate-500">{alerts.length} updates</span>
        </div>
        <AlertList alerts={alerts.slice(0, 5)} compact />
      </section>
    </div>
  );
}

function NextGameBanner({ game }: { game: Game | null }) {
  if (!game) {
    return (
      <section className="court-card court-line-bg sticky top-[92px] z-20 overflow-hidden p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-950 text-orange-300">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">Next Game</p>
            <h2 className="text-xl font-black text-slate-950">Choose teams to follow</h2>
            <p className="text-sm font-medium text-slate-600">Search registered teams or player names from the Teams tab.</p>
          </div>
        </div>
      </section>
    );
  }

  const matchup = gameMatchupDisplayName(game);

  return (
    <section className="court-card court-line-bg sticky top-[92px] z-20 overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-2 py-1 text-[11px] font-black uppercase text-white">
            <Clock3 className="h-3 w-3" />
            NEXT
          </div>
          <h2 className="text-2xl font-black text-slate-950">{game.scheduledTime}</h2>
          <p className="mt-1 text-sm font-bold text-slate-700">{matchup}</p>
        </div>
        <div className="rounded-lg bg-slate-950 px-3 py-2 text-right text-white">
          <p className="text-[11px] font-bold uppercase text-orange-300">{game.courtName ?? "Court TBD"}</p>
          <p className="max-w-28 text-xs text-slate-300">{game.venueName ?? "Venue TBD"}</p>
        </div>
      </div>
    </section>
  );
}

function ProgramCard({ program }: { program: ProgramSummary }) {
  const found = program.teams.length;
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-950">
            {program.program.programName} <span className="text-slate-400">&mdash;</span> {found} followed
          </h2>
          {program.zeroStateMessage ? <p className="mt-2 text-sm font-semibold text-amber-700">{program.zeroStateMessage}</p> : null}
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-orange-500 text-white">
          <Users className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Next" value={program.nextGame?.scheduledTime ?? "TBD"} />
        <Metric label="Alerts" value={String(program.alertsCount)} />
      </div>

      <div className="mt-4 space-y-2">
        {program.teams.slice(0, 4).map((team) => (
          <div key={team.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-black text-slate-950">{teamDisplayName(team)}</p>
              <StatusBadge status={team.liveStatus} />
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {team.divisionName ?? "Division TBD"} {team.level ? ` / ${team.level}` : ""}
            </p>
            <p className="mt-2 text-sm text-slate-700">
              {team.nextGame ? `${team.nextGame.scheduledTime} ${team.nextGame.courtName ?? "Court TBD"}` : "Next game awaiting bracket"}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function ScheduleScreen({ games, programs }: { games: Game[]; programs: ProgramSummary[] }) {
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courtFilter, setCourtFilter] = useState("");
  const followedCount = programs.reduce((count, program) => count + program.teams.length, 0);
  const watchedTeamsByProgram = useMemo(
    () => new Map(programs.map((program) => [program.program.id, new Set(program.teams.map((team) => team.id))])),
    [programs]
  );
  const courts = Array.from(new Set(games.map((game) => game.courtName).filter(Boolean))).sort();

  const filteredGames = games.filter((game) => {
    if (programFilter !== "all") {
      const teamIds = watchedTeamsByProgram.get(programFilter);
      if (!teamIds?.has(game.homeTeamId ?? "") && !teamIds?.has(game.awayTeamId ?? "")) return false;
    }
    if (statusFilter !== "all" && game.status !== statusFilter) return false;
    if (courtFilter && game.courtName !== courtFilter) return false;
    return true;
  });

  const groups = groupGamesByDate(filteredGames);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/8 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
          <Search className="h-4 w-4 text-orange-300" />
          Schedule Filters
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          <FilterButton active={programFilter === "all"} onClick={() => setProgramFilter("all")}>
            All watched
          </FilterButton>
          {programs.map((program) => (
            <FilterButton key={program.program.id} active={programFilter === program.program.id} onClick={() => setProgramFilter(program.program.id)}>
              {program.program.programName}
            </FilterButton>
          ))}
        </div>
        <div className="mt-2 no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {["all", "playing_now", "upcoming", "final", "schedule_changed"].map((status) => (
            <FilterButton key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
              {status === "all" ? "All status" : labelStatus(status)}
            </FilterButton>
          ))}
        </div>
        <select
          value={courtFilter}
          onChange={(event) => setCourtFilter(event.target.value)}
          className="mt-2 h-11 w-full rounded-lg border border-white/12 bg-slate-950 px-3 text-sm font-semibold text-white"
        >
          <option value="">All courts</option>
          {courts.map((court) => (
            <option key={court} value={court ?? ""}>
              {court}
            </option>
          ))}
        </select>
      </section>

      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="px-1 text-sm font-black uppercase tracking-[0.16em] text-orange-300">{group.label}</h2>
          {group.games.map((game) => (
            <GameRow key={game.id} game={game} />
          ))}
        </section>
      ))}
      {groups.length === 0 ? (
        <section className="court-card p-4">
          <h2 className="text-xl font-black text-slate-950">No followed-team games yet</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {followedCount > 0
              ? "CourtWatch is waiting for the real Exposure schedule feed for your selected teams. No placeholder games are shown."
              : "Use Teams search to follow the registered teams you want on this schedule."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-10 shrink-0 rounded-lg px-3 text-sm font-black transition active:scale-95",
        active ? "bg-orange-500 text-white" : "border border-white/12 bg-slate-950 text-slate-200"
      )}
    >
      {children}
    </button>
  );
}

function GameRow({ game }: { game: Game }) {
  const bracketUrl = bracketUrlFromGame(game);
  const matchup = gameMatchupDisplayName(game);
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={game.status} />
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{game.gameType ?? "Pool"}</span>
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">{matchup}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">{formatGameDate(game.startsAt)}</p>
        </div>
        {game.homeScore !== null && game.awayScore !== null ? (
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-center text-white">
            <p className="text-xl font-black">
              {game.homeScore}-{game.awayScore}
            </p>
            <p className="text-[11px] font-bold text-orange-300">FINAL</p>
          </div>
        ) : (
          <div className="rounded-lg bg-orange-500 px-3 py-2 text-center text-white">
            <p className="text-xl font-black">{game.scheduledTime}</p>
            <p className="text-[11px] font-bold">{game.courtName ?? "Court TBD"}</p>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-semibold text-slate-700">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-orange-500" />
          {game.venueName ?? "Venue TBD"}
        </span>
        <span className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-orange-500" />
          {game.courtName ?? "Court TBD"}
        </span>
      </div>
      {bracketUrl ? (
        <a href={bracketUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg bg-slate-100 px-3 text-sm font-black text-slate-800">
          <Trophy className="h-4 w-4 text-orange-500" />
          Official bracket
          <ChevronRight className="h-4 w-4" />
        </a>
      ) : null}
    </article>
  );
}

function TeamsScreen({ dashboard }: { dashboard: DashboardResponse }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const selectedProgram = dashboard.programs[0];
  const teamsQuery = useQuery({
    queryKey: ["teams", deferredSearch],
    queryFn: () => CourtWatchApi.teams(deferredSearch)
  });
  const refreshSelection = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["games"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  };
  const followTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.followTeam(teamId),
    onSuccess: refreshSelection
  });
  const unfollowTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.unfollowTeam(teamId),
    onSuccess: refreshSelection
  });
  const teams = teamsQuery.data ?? [];
  const pendingTeamId = String(followTeam.variables ?? unfollowTeam.variables ?? "");
  const focusedTeam = selectedProgram?.teams.find((team) => team.id === focusedTeamId) ?? null;

  return (
    <div className="space-y-4">
      <section className="court-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">Team Selection</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{selectedProgram?.teams.length ?? 0} teams followed</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">Nothing is preselected. Search a registered team or player name, then tap Follow.</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-orange-500 text-white">
            <Search className="h-5 w-5" />
          </div>
        </div>
        <label className="mt-4 flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-orange-500">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search team or registered player"
            className="min-h-11 flex-1 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <p className="mt-2 text-xs font-semibold text-slate-500">Player search uses Exposure roster/player data when it is available through the official API.</p>
      </section>

      {selectedProgram && selectedProgram.teams.length > 0 ? (
        <section className="court-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-950">Following</h2>
            <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">{selectedProgram.teams.length} active</span>
          </div>
          <div className="space-y-2">
            {selectedProgram.teams.map((team) => (
              <FollowedTeamRow
                key={team.id}
                team={team}
                focused={focusedTeamId === team.id}
                onFocus={() => setFocusedTeamId(team.id)}
                onUnfollow={() => {
                  if (focusedTeamId === team.id) setFocusedTeamId(null);
                  unfollowTeam.mutate(team.id);
                }}
                pending={unfollowTeam.isPending && pendingTeamId === team.id}
              />
            ))}
          </div>
        </section>
      ) : null}

      {focusedTeam ? <TeamFocusPanel team={focusedTeam} /> : null}

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-black uppercase tracking-[0.16em] text-orange-300">{deferredSearch ? "Search Results" : "Registered Teams"}</h2>
        {teamsQuery.isLoading ? <div className="h-28 animate-pulse rounded-lg bg-white/12" /> : null}
        {!teamsQuery.isLoading && teams.length === 0 ? (
          <div className="court-card p-4">
            <h3 className="text-lg font-black text-slate-950">No matches found</h3>
            <p className="mt-1 text-sm font-semibold text-slate-600">Try a team name, club name, division, or player name from official roster data.</p>
          </div>
        ) : null}
        {teams.map((team) => (
          <TeamSearchCard
            key={team.id}
            team={team}
            onFollow={() => followTeam.mutate(team.id)}
            onUnfollow={() => unfollowTeam.mutate(team.id)}
            pending={(followTeam.isPending || unfollowTeam.isPending) && pendingTeamId === team.id}
          />
        ))}
      </section>
    </div>
  );
}

function FollowedTeamRow({
  team,
  focused,
  onFocus,
  onUnfollow,
  pending
}: {
  team: ProgramSummary["teams"][number];
  focused: boolean;
  onFocus: () => void;
  onUnfollow: () => void;
  pending: boolean;
}) {
  const displayName = teamDisplayName(team);
  return (
    <article className={clsx("rounded-lg border bg-white p-3", focused ? "border-orange-400 ring-2 ring-orange-100" : "border-slate-200")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-slate-950">{displayName}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">{team.divisionName ?? "Division TBD"}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {team.gender ?? "Any"} / {team.gradeLevel ?? "Grade TBD"} / {team.level ?? "Level TBD"}
          </p>
        </div>
        <button
          type="button"
          onClick={onUnfollow}
          disabled={pending}
          className="min-h-10 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 active:scale-95 disabled:opacity-60"
        >
          {pending ? "..." : "Unfollow"}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Next" value={team.nextGame ? `${team.nextGame.scheduledTime} ${team.nextGame.courtName ?? "Court TBD"}` : "TBD"} />
        <Metric label="Last" value={team.lastResult ? scoreSummary(team.lastResult) : "No result"} />
      </div>
      <button
        type="button"
        onClick={onFocus}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white active:scale-[0.99]"
      >
        <Trophy className="h-4 w-4 text-orange-300" />
        Schedule & bracket
      </button>
    </article>
  );
}

function TeamFocusPanel({ team }: { team: ProgramSummary["teams"][number] }) {
  const divisionGamesQuery = useQuery({
    queryKey: ["division-games", team.divisionId],
    queryFn: () => CourtWatchApi.games(`?scope=division&division=${encodeURIComponent(team.divisionId ?? "")}`),
    enabled: Boolean(team.divisionId)
  });
  const divisionGames = divisionGamesQuery.data ?? [];
  const teamGames = divisionGames.filter((game) => gameBelongsToTeam(game, team));
  const bracketGames = divisionGames.filter(isBracketGame);
  const bracketUrl = bracketGames.map(bracketUrlFromGame).find(Boolean);
  const displayName = teamDisplayName(team);

  return (
    <section className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">Focused Team</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">{displayName}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">{team.divisionName ?? "Division TBD"}</p>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-orange-300">
          <Trophy className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Next court" value={team.nextGame?.courtName ?? "TBD"} />
        <Metric label="Bracket games" value={divisionGamesQuery.isLoading ? "..." : String(bracketGames.length)} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-950">Team Schedule</h3>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{teamGames.length} games</span>
        </div>
        <MiniGameList games={teamGames} loading={divisionGamesQuery.isLoading} empty="No official games published for this team yet." />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-950">Division Bracket</h3>
          {bracketUrl ? (
            <a href={bracketUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-orange-500 px-3 text-xs font-black text-white">
              Official
              <ChevronRight className="h-4 w-4" />
            </a>
          ) : null}
        </div>
        <MiniGameList games={bracketGames} loading={divisionGamesQuery.isLoading} empty="No bracket games published for this division yet." />
      </div>
    </section>
  );
}

function MiniGameList({ games, loading, empty }: { games: Game[]; loading: boolean; empty: string }) {
  if (loading) return <div className="h-24 animate-pulse rounded-lg bg-slate-100" />;
  if (games.length === 0) return <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">{empty}</p>;

  return (
    <div className="space-y-2">
      {games.map((game) => (
        <article key={game.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={game.status} />
                <span className="truncate text-xs font-black uppercase tracking-[0.14em] text-slate-400">{game.gameType ?? "Pool"}</span>
              </div>
              <p className="mt-2 text-sm font-black text-slate-950">
                {gameMatchupDisplayName(game)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{formatGameDate(game.startsAt)}</p>
            </div>
            <div className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-center text-white">
              <p className="text-sm font-black">{game.scheduledTime}</p>
              <p className="text-[11px] font-bold">{game.courtName ?? "Court TBD"}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function TeamSearchCard({
  team,
  onFollow,
  onUnfollow,
  pending
}: {
  team: Team;
  onFollow: () => void;
  onUnfollow: () => void;
  pending: boolean;
}) {
  const followed = Boolean(team.isFollowed);
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-black text-slate-950">{teamDisplayName(team)}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">{team.divisionName ?? "Division TBD"}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {team.gender ?? "Any"} / {team.gradeLevel ?? "Grade TBD"} / {team.level ?? "Level TBD"}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={followed ? onUnfollow : onFollow}
          className={clsx(
            "min-h-11 shrink-0 rounded-lg px-4 text-sm font-black active:scale-95 disabled:opacity-60",
            followed ? "border border-slate-200 bg-white text-slate-800" : "bg-orange-500 text-white"
          )}
        >
          {pending ? "..." : followed ? "Following" : "Follow"}
        </button>
      </div>
      {team.playerMatchNames && team.playerMatchNames.length > 0 ? (
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800">Player match: {team.playerMatchNames.slice(0, 3).join(", ")}</p>
      ) : null}
      {team.sourceUrl ? (
        <a href={team.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-black text-orange-600">
          Official team page
          <ChevronRight className="h-4 w-4" />
        </a>
      ) : null}
    </article>
  );
}

function AlertsScreen({ alerts, games }: { alerts: GameChangeEvent[]; games: Game[] }) {
  return (
    <section className="court-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-950">Alerts</h2>
        <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">{alerts.length} recent</span>
      </div>
      <AlertList alerts={alerts} games={games} />
    </section>
  );
}

function AlertList({ alerts, games = [], compact = false }: { alerts: GameChangeEvent[]; games?: Game[]; compact?: boolean }) {
  if (alerts.length === 0) {
    return <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">No alerts yet. CourtWatch is monitoring for changes.</p>;
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const game = games.find((item) => item.id === alert.gameId);
        return (
          <article key={alert.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-orange-500 text-white">
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-slate-950">{labelStatus(alert.eventType)}</p>
                  <span className="text-[11px] font-bold text-slate-400">{formatShortTime(alert.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {game ? gameMatchupDisplayName(game) : stringifyChange(alert.newValue)}
                </p>
                {!compact ? <p className="mt-1 text-xs text-slate-500">{stringifyChange(alert.newValue)}</p> : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SettingsScreen({ dashboard, onRefresh }: { dashboard: DashboardResponse; onRefresh: () => void }) {
  const [adminSecret, setAdminSecret] = useState("");
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const syncMutation = useMutation({
    mutationFn: () => CourtWatchApi.syncNow(adminSecret),
    onSuccess: (result) => {
      setAdminMessage(`Sync complete: ${result.teamsCount} teams, ${result.gamesCount} games`);
      onRefresh();
    },
    onError: (error) => setAdminMessage(error instanceof Error ? error.message : "Sync failed")
  });

  const subscribe = async () => {
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
      if (!publicKey) {
        setPushMessage("VAPID public key is not configured yet.");
        return;
      }
      const subscription = await requestPushSubscription(publicKey);
      await CourtWatchApi.subscribePush(subscription, Intl.DateTimeFormat().resolvedOptions().timeZone);
      setPushMessage("Push notifications enabled for this device.");
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Unable to enable notifications.");
    }
  };

  return (
    <div className="space-y-4">
      <section className="court-card p-4">
        <h2 className="text-2xl font-black text-slate-950">Settings</h2>
        <div className="mt-4 space-y-3">
          <SettingRow icon={Bell} title="Notifications" value="Game changes, scores, courts, brackets" />
          <SettingRow icon={Clock3} title="Refresh frequency" value="60s during active tournament hours" />
          <SettingRow icon={Activity} title="Source status" value={`${dashboard.sourceStatus.source} / ${dashboard.sourceStatus.status}`} />
          <SettingRow icon={Smartphone} title="API URL" value={apiBaseUrl()} />
        </div>
        <button type="button" onClick={subscribe} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-black text-white active:scale-[0.99]">
          <Bell className="h-4 w-4" />
          Enable Push Notifications
        </button>
        {pushMessage ? <p className="mt-2 text-sm font-semibold text-slate-600">{pushMessage}</p> : null}
      </section>

      <section className="court-card p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-black text-slate-950">Admin Sync</h2>
        </div>
        <input
          value={adminSecret}
          onChange={(event) => setAdminSecret(event.target.value)}
          type="password"
          placeholder="ADMIN_SECRET"
          className="mt-3 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none focus:border-orange-500"
        />
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white active:scale-[0.99]"
        >
          <RefreshCcw className={clsx("h-4 w-4", syncMutation.isPending && "animate-spin")} />
          Sync Now
        </button>
        {adminMessage ? <p className="mt-2 text-sm font-semibold text-slate-600">{adminMessage}</p> : null}
      </section>

      <section className="rounded-lg border border-white/12 bg-white/8 p-4 text-sm font-medium leading-6 text-slate-200">
        {dashboard.disclaimer}
      </section>
    </div>
  );
}

function SettingRow({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-orange-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="font-black text-slate-950">{title}</p>
        <p className="truncate text-sm font-semibold text-slate-500">{value}</p>
      </div>
    </div>
  );
}

function BottomTabs({ activeTab, setActiveTab }: { activeTab: Tab; setActiveTab: (tab: Tab) => void }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#07111f]/95 px-2 pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg text-[8px] font-black leading-none transition active:scale-95 sm:text-[11px]",
                active ? "bg-orange-500 text-white" : "text-slate-300"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="block w-full text-center">
                {tab.id === "dashboard" ? (
                  <>
                    Dash
                    <br />
                    board
                  </>
                ) : (
                  tab.label
                )}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = labelStatus(status);
  const tone =
    status === "final"
      ? "bg-slate-900 text-white"
      : status === "playing_now"
        ? "bg-emerald-500 text-white"
        : status === "schedule_changed"
          ? "bg-amber-400 text-slate-950"
          : status === "awaiting_bracket"
            ? "bg-slate-200 text-slate-700"
            : "bg-orange-500 text-white";
  return <span className={clsx("rounded-md px-2 py-1 text-[11px] font-black uppercase", tone)}>{label}</span>;
}

function SkeletonDashboard() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-36 animate-pulse rounded-lg bg-white/12" />
      ))}
    </div>
  );
}

function groupGamesByDate(games: Game[]) {
  const formatter = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
  const today = "2026-05-23";
  const tomorrow = "2026-05-24";
  const grouped = new Map<string, Game[]>();
  for (const game of games) {
    const key = game.scheduledDate;
    grouped.set(key, [...(grouped.get(key) ?? []), game]);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, groupGames]) => ({
      label: date === today ? "Today" : date === tomorrow ? "Tomorrow" : formatter.format(new Date(`${date}T12:00:00.000Z`)),
      games: groupGames.sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
    }));
}

function labelStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Playing Now", "LIVE")
    .replace("Schedule Changed", "CHANGED")
    .replace("New Game Added", "NEW GAME");
}

function formatShortTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(iso));
}

function formatGameDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles"
  }).format(new Date(iso));
}

function scoreSummary(game: Game): string {
  if (game.homeScore === null || game.awayScore === null) return "No score posted";
  return `${gameTeamDisplayName(game.homeTeamNameSnapshot, game, "Home")} ${game.homeScore}, ${gameTeamDisplayName(game.awayTeamNameSnapshot, game, "Away")} ${game.awayScore}`;
}

type TeamNameDisplayInput = Pick<Team, "name" | "divisionName" | "gradeLevel">;

function teamDisplayName(team: TeamNameDisplayInput): string {
  const ageLabel = splashCityAgeLabel(team.name, team.divisionName, team.gradeLevel);
  return ageLabel ? `Splash City ${ageLabel}` : team.name;
}

function gameMatchupDisplayName(game: Game): string {
  return `${gameTeamDisplayName(game.homeTeamNameSnapshot, game)} vs ${gameTeamDisplayName(game.awayTeamNameSnapshot, game)}`;
}

function gameTeamDisplayName(name: string | null, game: Game, fallback = "TBD"): string {
  if (!name) return fallback;
  const ageLabel = splashCityAgeLabel(name, divisionNameFromGame(game));
  return ageLabel ? `Splash City ${ageLabel}` : name;
}

function splashCityAgeLabel(name: string, ...contexts: Array<string | null | undefined>): string | null {
  if (!isSplashCityName(name)) return null;

  const sources = [name, ...contexts].filter((value): value is string => Boolean(value));
  return sources.map(extractAgeLabel).find(Boolean) ?? sources.map(extractGradeAgeLabel).find(Boolean) ?? null;
}

function isSplashCityName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compact = normalized.replace(/\s+/g, "");
  return compact.startsWith("splashcity") || normalized.startsWith("splash city ");
}

function extractAgeLabel(value: string): string | null {
  const match = value.match(/\b(\d{1,2})\s*u\b/i);
  return match ? `${Number(match[1])}U` : null;
}

function extractGradeAgeLabel(value: string): string | null {
  const grades = Array.from(value.toLowerCase().matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s*(?:grade)?\b/g)).map((match) => Number(match[1]));
  const highestGrade = Math.max(...grades.filter(Number.isFinite));
  if (!Number.isFinite(highestGrade)) return null;
  const age = highestGrade + 6;
  return age >= 6 && age <= 19 ? `${age}U` : null;
}

function gameBelongsToTeam(game: Game, team: Team): boolean {
  return game.homeTeamId === team.id || game.awayTeamId === team.id;
}

function isBracketGame(game: Game): boolean {
  const gameType = game.gameType?.toLowerCase() ?? "";
  if (!gameType) return false;
  if (gameType.startsWith("pool")) return false;
  return ["championship", "consolation", "play in", "gold", "silver", "bracket"].some((keyword) => gameType.includes(keyword));
}

function bracketUrlFromGame(game: Game): string | null {
  if (!game.rawJson || typeof game.rawJson !== "object" || Array.isArray(game.rawJson)) return null;
  const value = (game.rawJson as { BracketUrl?: unknown }).BracketUrl;
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

function divisionNameFromGame(game: Game): string | null {
  if (!game.rawJson || typeof game.rawJson !== "object" || Array.isArray(game.rawJson)) return null;
  const raw = game.rawJson as Record<string, unknown>;
  for (const key of ["DivisionName", "divisionName", "Division", "division", "AgeGroup", "ageGroup"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function stringifyChange(value: unknown): string {
  if (value === null || value === undefined) return "Update posted";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "Update posted";
  }
}
