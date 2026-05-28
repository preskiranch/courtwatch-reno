"use client";

import {
  buildTeamScoringLeaders,
  filterTeamScoringLeadersByDivisionIds,
  withEffectiveGameStatus,
  withEffectiveGameStatuses,
  type DashboardResponse,
  type DivisionResult,
  type Game,
  type GameChangeEvent,
  type ProgramSummary,
  type Team,
  type TeamScoringLeader,
  type TournamentEvent,
} from "@courtwatch/core";
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
  Globe2,
  Home,
  Instagram,
  MapPin,
  Medal,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  Smartphone,
  Trophy,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CourtWatchApi, apiBaseUrl } from "../lib/api";
import { stableClientId } from "../lib/client-id";
import {
  DEFAULT_TOURNAMENT_TIME_ZONE,
  dateKeyInTimeZone,
  scheduleDateSectionLabel,
} from "../lib/date-labels";
import {
  dashboardWithRegisteredFollows,
  programWithRegisteredFollows,
} from "../lib/followed-team-reconciliation";
import {
  finalResultGroupsForFollowedTeams,
  type FollowedFinalResultGroup,
} from "../lib/final-result-groups";
import {
  forgetStoredFollowedTeam,
  loadStoredFollowedTeams,
  mergeStoredFollowedTeams,
  mergeTeamLists,
  rememberStoredFollowedTeam,
} from "../lib/followed-team-storage";
import { requestPushSubscription } from "../lib/push";
import {
  DASHBOARD_FOLLOW_MIGRATION_KEY,
  LEGACY_DIVISION_COMPARE_STORAGE_KEY,
  SELECTED_EVENT_STORAGE_KEY,
  dashboardFollowMigrationStorageKey,
  divisionCompareStorageKey,
} from "../lib/storage-keys";

type Tab = "dashboard" | "schedule" | "teams" | "alerts" | "settings";
type PointsLeaderMode = "overall" | "compare";
type TeamRecord = Pick<
  TeamScoringLeader,
  "wins" | "losses" | "ties" | "gamesScored" | "totalPoints"
> & {
  finalGames: number;
  gamesSeen: number;
};

const tabs: Array<{
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "teams", label: "Teams", icon: Users },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

const LIVE_DATA_REFETCH_MS = 60_000;
const PASSIVE_DATA_REFETCH_MS = 12 * 60_000;
const DEFAULT_TRACKED_EXPOSURE_EVENT_ID = 255539;

export function CourtWatchApp() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [toast, setToast] = useState<string | null>(null);
  const [presenceClientId, setPresenceClientId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const clientReady = Boolean(presenceClientId);
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: CourtWatchApi.events,
    staleTime: 5 * 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const fetchedEvents = eventsQuery.data ?? [];
  const activeEventId =
    selectedEventId ??
    fetchedEvents[0]?.exposureEventId ??
    DEFAULT_TRACKED_EXPOSURE_EVENT_ID;
  const fetchedActiveEvent =
    fetchedEvents.find((event) => event.exposureEventId === activeEventId) ??
    null;
  const todayKey = useTournamentTodayKey(
    fetchedActiveEvent?.timezone ?? DEFAULT_TOURNAMENT_TIME_ZONE,
  );
  const liveStatusNow = useLiveStatusNow();
  const dataRefetchInterval = fetchedActiveEvent
    ? dataRefetchIntervalForEvent(fetchedActiveEvent, todayKey)
    : LIVE_DATA_REFETCH_MS;
  const lastTodayKeyRef = useRef(todayKey);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", presenceClientId, activeEventId],
    queryFn: () => CourtWatchApi.dashboard(activeEventId),
    enabled: clientReady && Boolean(activeEventId),
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const gamesQuery = useQuery({
    queryKey: ["games", presenceClientId, activeEventId],
    queryFn: () => CourtWatchApi.games("", activeEventId),
    enabled: clientReady && Boolean(activeEventId),
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const alertsQuery = useQuery({
    queryKey: ["alerts", presenceClientId, activeEventId],
    queryFn: () => CourtWatchApi.alerts(activeEventId),
    enabled: clientReady && Boolean(activeEventId),
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const presenceQuery = useQuery({
    queryKey: ["presence", presenceClientId, activeTab],
    queryFn: () =>
      CourtWatchApi.presenceHeartbeat(
        presenceClientId ?? "unknown-client",
        activeTab,
      ),
    enabled: clientReady,
    refetchInterval: 25_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    setPresenceClientId(stableClientId());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(
      window.localStorage.getItem(SELECTED_EVENT_STORAGE_KEY),
    );
    if (Number.isFinite(saved) && saved > 0) setSelectedEventId(saved);
  }, []);

  useEffect(() => {
    if (!eventsQuery.data?.length) return;
    setSelectedEventId((current) => {
      if (
        current &&
        eventsQuery.data.some((event) => event.exposureEventId === current)
      )
        return current;
      return eventsQuery.data[0]?.exposureEventId ?? null;
    });
  }, [eventsQuery.data]);

  const selectEvent = (eventId: number) => {
    setSelectedEventId(eventId);
    if (typeof window !== "undefined")
      window.localStorage.setItem(SELECTED_EVENT_STORAGE_KEY, String(eventId));
    setActiveTab("dashboard");
  };

  useEffect(() => {
    if (lastTodayKeyRef.current === todayKey) return;
    lastTodayKeyRef.current = todayKey;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
      queryClient.invalidateQueries({ queryKey: ["results"] }),
      queryClient.invalidateQueries({ queryKey: ["points-leaders"] }),
    ]);
  }, [queryClient, todayKey]);

  useEffect(() => {
    if (
      !presenceClientId ||
      !dashboardQuery.data ||
      typeof window === "undefined"
    )
      return;
    const migrationKey = `courtwatch:follow-migration:${presenceClientId}`;
    if (window.localStorage.getItem(migrationKey)) return;
    if (dashboardTeamIds(dashboardQuery.data).length > 0) {
      window.localStorage.setItem(migrationKey, "complete");
      return;
    }
    const teamIds = dashboardFollowMigrationTeamIds(presenceClientId);
    if (teamIds.length === 0) {
      window.localStorage.setItem(migrationKey, "complete");
      return;
    }

    let cancelled = false;
    window.localStorage.setItem(migrationKey, "running");
    void Promise.all(teamIds.map((teamId) => CourtWatchApi.followTeam(teamId)))
      .then(() => {
        if (cancelled) return;
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["games"] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
        queryClient.invalidateQueries({ queryKey: ["teams"] });
        queryClient.invalidateQueries({ queryKey: ["points-leaders"] });
        window.localStorage.setItem(migrationKey, "complete");
      })
      .catch(() => {
        window.localStorage.removeItem(migrationKey);
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardQuery.data, presenceClientId, queryClient]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
      queryClient.invalidateQueries({ queryKey: ["results"] }),
      queryClient.invalidateQueries({ queryKey: ["points-leaders"] }),
    ]);
    setToast("Schedule refreshed");
    window.setTimeout(() => setToast(null), 2200);
  };

  const dashboard = useMemo(
    () =>
      dashboardQuery.data
        ? dashboardWithEffectiveGameStatuses(dashboardQuery.data, liveStatusNow)
        : undefined,
    [dashboardQuery.data, liveStatusNow],
  );
  const games = useMemo(
    () => withEffectiveGameStatuses(gamesQuery.data ?? [], liveStatusNow),
    [gamesQuery.data, liveStatusNow],
  );
  const fallbackEvents = dashboard?.events?.length
    ? dashboard.events
    : dashboard?.event
      ? [dashboard.event]
      : [];
  const displayEvents =
    fetchedEvents.length > 0 ? fetchedEvents : fallbackEvents;
  const hasNoEvents =
    !eventsQuery.isLoading && displayEvents.length === 0 && !dashboard;
  const isLoading =
    !presenceClientId ||
    eventsQuery.isLoading ||
    (!hasNoEvents && (!activeEventId || dashboardQuery.isLoading));
  const offline =
    dashboardQuery.isError || gamesQuery.isError || alertsQuery.isError;

  return (
    <>
      <ShareQrRail />
      <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-24 pt-4 text-white sm:max-w-3xl md:max-w-5xl">
        <AppHeader
          dashboard={dashboard}
          events={displayEvents}
          selectedEventId={activeEventId}
          offline={offline}
          activeUsers={presenceQuery.data?.activeUsers ?? null}
          onRefresh={refresh}
          refreshing={dashboardQuery.isFetching || gamesQuery.isFetching}
          onSelectEvent={selectEvent}
        />

        <div className="mt-4 xl:hidden">
          <ShareQrMobileCard />
        </div>

        {toast ? (
          <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 rounded-lg border border-orange-300/50 bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl">
            {toast}
          </div>
        ) : null}

        <section className="mt-4 flex-1">
          {isLoading ? <SkeletonDashboard /> : null}
          {!isLoading && hasNoEvents ? <NoTournamentEvents /> : null}
          {!isLoading &&
          dashboard &&
          presenceClientId &&
          activeTab === "dashboard" ? (
            <DashboardScreen
              dashboard={dashboard}
              alerts={alertsQuery.data ?? dashboard.alerts}
              games={games}
              clientId={presenceClientId}
              onRefresh={refresh}
              eventId={activeEventId}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "schedule" ? (
            <ScheduleScreen
              games={games}
              programs={dashboard.programs}
              todayKey={todayKey}
              timezone={dashboard.event.timezone}
              eventId={activeEventId}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "teams" ? (
            <TeamsScreen
              dashboard={dashboard}
              eventId={activeEventId}
              clientId={presenceClientId}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "alerts" ? (
            <AlertsScreen
              alerts={alertsQuery.data ?? dashboard.alerts}
              games={games}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "settings" ? (
            <SettingsScreen
              dashboard={dashboard}
              onRefresh={refresh}
              eventId={activeEventId}
            />
          ) : null}
        </section>

        <BottomTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      </main>
    </>
  );
}

function ShareQrRail() {
  return (
    <aside className="fixed left-3 top-32 z-20 hidden w-28 xl:block 2xl:left-6 2xl:w-36">
      <ShareQrCard layout="rail" />
    </aside>
  );
}

function ShareQrMobileCard() {
  return (
    <div className="flex justify-start">
      <ShareQrCard layout="mobile" />
    </div>
  );
}

function ShareQrCard({ layout }: { layout: "rail" | "mobile" }) {
  const qrSize =
    layout === "rail" ? "h-24 w-24 2xl:h-32 2xl:w-32" : "h-20 w-20";
  return (
    <section
      className={clsx(
        "pointer-events-none rounded-lg border border-white/12 bg-[#07111f]/92 p-2 text-white shadow-2xl backdrop-blur",
        layout === "rail"
          ? "text-center"
          : "flex max-w-[320px] items-center gap-3",
      )}
      aria-label="Share Court Watch AAU"
    >
      <img
        src="/share/courtwatch-reno-qr.jpg"
        alt="QR code for Court Watch AAU"
        className={clsx(
          "shrink-0 rounded-md border border-white bg-white object-contain",
          qrSize,
        )}
      />
      <div className={layout === "rail" ? "mt-2" : "min-w-0"}>
        <div
          className={clsx(
            "flex items-center gap-1 text-orange-300",
            layout === "rail" ? "justify-center" : "",
          )}
        >
          <Share2 className="h-3.5 w-3.5" />
          <p className="text-[11px] font-black uppercase tracking-[0.12em]">
            Share
          </p>
        </div>
        <p
          className={clsx(
            "font-black leading-tight",
            layout === "rail" ? "mt-1 text-sm" : "text-base",
          )}
        >
          Share with your friends
        </p>
        <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-300">
          Scan to open Court Watch AAU.
        </p>
      </div>
    </section>
  );
}

function AppHeader({
  dashboard,
  events,
  selectedEventId,
  offline,
  activeUsers,
  onRefresh,
  refreshing,
  onSelectEvent,
}: {
  dashboard?: DashboardResponse;
  events: TournamentEvent[];
  selectedEventId: number | null;
  offline: boolean;
  activeUsers: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  onSelectEvent: (eventId: number) => void;
}) {
  const selectedEvent =
    events.find((event) => event.exposureEventId === selectedEventId) ??
    dashboard?.event;
  const trackedEvents = events.filter(
    (event) => event.dropdownGroup === "tracked",
  );
  const discoveredEvents = events.filter(
    (event) => event.dropdownGroup !== "tracked",
  );
  const hasGroupedEvents =
    trackedEvents.length > 0 && discoveredEvents.length > 0;
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#07111f]/92 px-4 pb-3 pt-3 backdrop-blur">
      <div className="mb-3 flex justify-center">
        <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-bold text-slate-200">
          <span className="whitespace-nowrap">Designed by PreskiRanch LLC</span>
          <span className="h-3 w-px bg-white/20" />
          <a
            href="https://www.instagram.com/PreskiRanch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap text-orange-300"
          >
            <Instagram className="h-3.5 w-3.5" />
            @PreskiRanch
          </a>
        </div>
      </div>
      <nav
        aria-label="Court Watch AAU website links"
        className="mb-3 flex justify-center gap-2 overflow-x-auto text-[11px] font-black text-slate-200 no-scrollbar"
      >
        <a
          href="/install"
          className="whitespace-nowrap rounded-lg border border-white/10 bg-white/8 px-3 py-1.5"
        >
          Install
        </a>
        <a
          href="/support"
          className="whitespace-nowrap rounded-lg border border-white/10 bg-white/8 px-3 py-1.5"
        >
          Support
        </a>
        <a
          href="/privacy"
          className="whitespace-nowrap rounded-lg border border-white/10 bg-white/8 px-3 py-1.5"
        >
          Privacy
        </a>
        <a
          href="/terms"
          className="whitespace-nowrap rounded-lg border border-white/10 bg-white/8 px-3 py-1.5"
        >
          Terms
        </a>
      </nav>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
            <Radio className="h-3.5 w-3.5" />
            {selectedEvent?.organizer ?? "Reno Memorial Day"}
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-normal text-white">
            Court Watch AAU
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-white/12 bg-white/8 px-3 text-white"
            title="Active users online"
          >
            <Users className="h-4 w-4 text-emerald-300" />
            <span className="text-left leading-none">
              <span className="block text-sm font-black">
                {activeUsers ?? "-"}
              </span>
              <span className="mt-0.5 block whitespace-nowrap text-[9px] font-black uppercase tracking-normal text-slate-300">
                Active users
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/12 bg-white/8 text-white transition active:scale-95"
            aria-label="Refresh schedule"
          >
            <RefreshCcw
              className={clsx("h-5 w-5", refreshing && "animate-spin")}
            />
          </button>
        </div>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
          Tournament
        </span>
        <select
          value={selectedEventId ?? ""}
          onChange={(event) => onSelectEvent(Number(event.target.value))}
          className="h-11 w-full rounded-lg border border-white/12 bg-slate-950 px-3 text-sm font-black text-white"
          disabled={events.length === 0}
        >
          {events.length === 0 ? (
            <option value="">
              No public-source tournaments found in the next six months
            </option>
          ) : null}
          {hasGroupedEvents ? (
            <>
              <optgroup label="My tracked events">
                {trackedEvents.map((event) => (
                  <TournamentOption key={event.exposureEventId} event={event} />
                ))}
              </optgroup>
              <optgroup label="Upcoming public-source tournaments">
                {discoveredEvents.map((event) => (
                  <TournamentOption key={event.exposureEventId} event={event} />
                ))}
              </optgroup>
            </>
          ) : (
            events.map((event) => (
              <TournamentOption key={event.exposureEventId} event={event} />
            ))
          )}
        </select>
      </label>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          {offline ? (
            <WifiOff className="h-3.5 w-3.5 text-orange-300" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          )}
          {offline
            ? "Offline cache"
            : (dashboard?.sourceStatus.message ?? "Loading source")}
        </span>
        <span>
          {dashboard?.lastUpdated
            ? `Updated ${formatShortTime(dashboard.lastUpdated, dashboard.event.timezone)}`
            : "Sync pending"}
        </span>
      </div>
    </header>
  );
}

function TournamentOption({ event }: { event: TournamentEvent }) {
  return (
    <option value={event.exposureEventId}>
      {tournamentOptionLabel(event)}
    </option>
  );
}

function tournamentOptionLabel(event: TournamentEvent): string {
  const place =
    event.city && event.state
      ? `${event.city}, ${event.state}`
      : event.location;
  const date = compactTournamentDate(event.startDate, event.timezone);
  const teamLabel =
    event.registeredTeamCount > 0
      ? `${event.registeredTeamCount} teams`
      : "teams not posted yet";
  return `${event.name} — ${place} — ${date} — ${teamLabel}`;
}

function compactTournamentDate(
  dateKey: string,
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function DashboardScreen({
  dashboard,
  alerts,
  games,
  clientId,
  onRefresh,
  eventId,
}: {
  dashboard: DashboardResponse;
  alerts: GameChangeEvent[];
  games: Game[];
  clientId: string;
  onRefresh: () => void;
  eventId: number | null;
}) {
  const queryClient = useQueryClient();
  const allGamesQuery = useQuery({
    queryKey: ["games", "all", eventId],
    queryFn: () => CourtWatchApi.allGames(eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const teamsQuery = useQuery({
    queryKey: ["teams", "all", eventId],
    queryFn: () => CourtWatchApi.teams("", eventId),
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const pointsLeadersQuery = useQuery({
    queryKey: ["points-leaders", eventId],
    queryFn: () => CourtWatchApi.pointsLeaders(eventId),
    enabled: Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const fallbackPointLeaders = useMemo(() => {
    const teams = teamsQuery.data ?? [];
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    return buildTeamScoringLeaders(allGamesQuery.data ?? [], teams, {
      includeUnscoredTeams: true,
    }).map((leader) => {
      const team = leader.teamId ? teamsById.get(leader.teamId) : null;
      return team ? { ...leader, teamName: teamDisplayName(team) } : leader;
    });
  }, [allGamesQuery.data, teamsQuery.data]);
  const dashboardPointLeaders = dashboard.pointsLeaders ?? [];
  const pointLeaders =
    pointsLeadersQuery.data && pointsLeadersQuery.data.length > 0
      ? pointsLeadersQuery.data
      : dashboardPointLeaders.length > 0
        ? dashboardPointLeaders
        : fallbackPointLeaders;
  const dashboardFollowedTeams = useMemo(
    () =>
      dashboard.programs.flatMap((program) =>
        program.teams.map((team) => ({ ...team, isFollowed: true })),
      ),
    [dashboard.programs],
  );
  const observedFollowedTeams = useMemo(
    () => mergeTeamLists(teamsQuery.data ?? [], dashboardFollowedTeams),
    [dashboardFollowedTeams, teamsQuery.data],
  );
  const { storedFollowedTeams } = useStoredFollowedTeams(
    clientId,
    eventId,
    observedFollowedTeams,
  );
  const trustedRegisteredTeams = useMemo(
    () =>
      teamsWithTrustedFollowState(teamsQuery.data ?? [], storedFollowedTeams),
    [storedFollowedTeams, teamsQuery.data],
  );
  const teamsForFollowState = useMemo(
    () => mergeTeamLists(trustedRegisteredTeams, storedFollowedTeams),
    [storedFollowedTeams, trustedRegisteredTeams],
  );
  const teamRecords = useMemo(
    () => buildTeamRecordMap(allGamesQuery.data ?? [], teamsForFollowState),
    [allGamesQuery.data, teamsForFollowState],
  );
  const recordsLoading = allGamesQuery.isLoading || teamsQuery.isLoading;
  const effectiveDashboard = useMemo(
    () =>
      dashboardWithRegisteredFollows(
        dashboard,
        teamsForFollowState,
        allGamesQuery.data ?? [],
        teamRecords,
      ),
    [allGamesQuery.data, dashboard, teamRecords, teamsForFollowState],
  );
  const finalResultFollowedTeams =
    storedFollowedTeams.length > 0
      ? storedFollowedTeams
      : effectiveDashboard.programs.flatMap((program) => program.teams);

  useEffect(() => {
    if (storedFollowedTeams.length === 0 || dashboardFollowedTeams.length === 0)
      return;
    const storedIds = new Set(storedFollowedTeams.map((team) => team.id));
    const staleServerTeamIds = dashboardFollowedTeams
      .map((team) => team.id)
      .filter((teamId) => !storedIds.has(teamId));
    if (staleServerTeamIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      staleServerTeamIds.map((teamId) => CourtWatchApi.unfollowTeam(teamId)),
    )
      .then(() => {
        if (cancelled) return;
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["games"] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["results"] });
        queryClient.invalidateQueries({ queryKey: ["teams"] });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [dashboardFollowedTeams, queryClient, storedFollowedTeams]);

  return (
    <div className="space-y-4">
      <NextGameBanner
        game={effectiveDashboard.nextGame}
        records={teamRecords}
      />

      <button
        type="button"
        onClick={onRefresh}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/8 px-4 text-sm font-semibold text-slate-100 active:scale-[0.99]"
      >
        <RefreshCcw className="h-4 w-4" />
        Pull to refresh
      </button>

      <div className="grid gap-3 md:grid-cols-2">
        {effectiveDashboard.programs.map((program) => (
          <ProgramCard
            key={program.program.id}
            program={program}
            records={teamRecords}
            recordsLoading={recordsLoading}
          />
        ))}
      </div>

      <PointsLeadersSection
        leaders={pointLeaders}
        loading={
          pointsLeadersQuery.isLoading &&
          dashboardPointLeaders.length === 0 &&
          fallbackPointLeaders.length === 0
        }
        clientId={clientId}
      />

      <FinalResultsSection
        clientId={clientId}
        eventId={eventId}
        followedTeams={finalResultFollowedTeams}
      />

      <section className="court-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-950">Latest Alerts</h2>
          <span className="text-xs font-bold text-slate-500">
            {alerts.length} updates
          </span>
        </div>
        <AlertList alerts={alerts.slice(0, 5)} games={games} compact />
      </section>
    </div>
  );
}

function NextGameBanner({
  game,
  records,
}: {
  game: Game | null;
  records: Map<string, TeamRecord>;
}) {
  if (!game) {
    return (
      <section className="court-card court-line-bg sticky top-[92px] z-20 overflow-hidden p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-950 text-orange-300">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
              Next Game
            </p>
            <h2 className="text-xl font-black text-slate-950">
              Choose teams to follow
            </h2>
            <p className="text-sm font-medium text-slate-600">
              Search registered teams from the Teams tab.
            </p>
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
          <h2 className="text-2xl font-black text-slate-950">
            {game.scheduledTime}
          </h2>
          <p className="mt-1 text-sm font-bold text-slate-700">{matchup}</p>
          <GameRecordsLine game={game} records={records} />
        </div>
        <div className="rounded-lg bg-slate-950 px-3 py-2 text-right text-white">
          <p className="text-[11px] font-bold uppercase text-orange-300">
            {game.courtName ?? "Court TBD"}
          </p>
          <p className="max-w-28 text-xs text-slate-300">
            {game.venueName ?? "Venue TBD"}
          </p>
        </div>
      </div>
    </section>
  );
}

function ProgramCard({
  program,
  records,
  recordsLoading,
}: {
  program: ProgramSummary;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
}) {
  const found = program.teams.length;
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-950">
            {program.program.programName}{" "}
            <span className="text-slate-400">&mdash;</span> {found} followed
          </h2>
          {program.zeroStateMessage ? (
            <p className="mt-2 text-sm font-semibold text-amber-700">
              {program.zeroStateMessage}
            </p>
          ) : null}
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
          <div
            key={team.id}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-black text-slate-950">
                {teamDisplayName(team)}
              </p>
              <StatusBadge status={team.liveStatus} />
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {team.divisionName ?? "Division TBD"}{" "}
              {team.level ? ` / ${team.level}` : ""}
            </p>
            <div className="mt-2">
              <TeamRecordBadge
                record={teamRecordForTeam(team, records)}
                loading={recordsLoading}
              />
            </div>
            <p className="mt-2 text-sm text-slate-700">
              {team.nextGame
                ? `${team.nextGame.scheduledTime} ${team.nextGame.courtName ?? "Court TBD"}`
                : "Next game awaiting bracket"}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

function PointsLeadersSection({
  leaders,
  loading,
  clientId,
}: {
  leaders: TeamScoringLeader[];
  loading: boolean;
  clientId: string;
}) {
  const [mode, setMode] = useState<PointsLeaderMode>("overall");
  const [divisionSearch, setDivisionSearch] = useState("");
  const [selectedDivisionKeys, setSelectedDivisionKeys] = useState<string[]>(
    () => loadStoredDivisionCompareKeys(clientId),
  );
  const [divisionPickerOpen, setDivisionPickerOpen] = useState(false);
  const deferredDivisionSearch = useDeferredValue(divisionSearch);
  const divisionOptions = useMemo(
    () => divisionCompareOptions(leaders),
    [leaders],
  );
  const validDivisionKeys = useMemo(
    () => new Set(divisionOptions.map((division) => division.divisionKey)),
    [divisionOptions],
  );
  const selectedDivisions = useMemo(
    () =>
      divisionOptions.filter((division) =>
        selectedDivisionKeys.includes(division.divisionKey),
      ),
    [divisionOptions, selectedDivisionKeys],
  );
  const selectedDivisionIds = useMemo(
    () => selectedDivisions.flatMap((division) => division.divisionIds),
    [selectedDivisions],
  );
  const compareLeaders = useMemo(
    () => filterTeamScoringLeadersByDivisionIds(leaders, selectedDivisionIds),
    [leaders, selectedDivisionIds],
  );
  const displayLeaders = mode === "compare" ? compareLeaders : leaders;
  const searchedDivisions = useMemo(() => {
    const query = deferredDivisionSearch.trim().toLowerCase();
    return query
      ? divisionOptions.filter((division) =>
          division.divisionName.toLowerCase().includes(query),
        )
      : divisionOptions;
  }, [deferredDivisionSearch, divisionOptions]);
  const badgeText = loading
    ? "..."
    : mode === "compare"
      ? `${selectedDivisions.length} selected`
      : `${leaders.length} teams`;

  useEffect(() => {
    setSelectedDivisionKeys(loadStoredDivisionCompareKeys(clientId));
  }, [clientId]);

  useEffect(() => {
    if (divisionOptions.length === 0) return;
    setSelectedDivisionKeys((current) => {
      const next = current.filter((divisionKey) =>
        validDivisionKeys.has(divisionKey),
      );
      return next.length === current.length ? current : next;
    });
  }, [divisionOptions.length, validDivisionKeys]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      divisionCompareStorageKey(clientId),
      JSON.stringify(selectedDivisionKeys),
    );
    window.localStorage.removeItem(LEGACY_DIVISION_COMPARE_STORAGE_KEY);
  }, [clientId, selectedDivisionKeys]);

  const toggleDivision = (divisionKey: string) => {
    const selecting = !selectedDivisionKeys.includes(divisionKey);
    const nextSelectionCount = selecting
      ? selectedDivisionKeys.length + 1
      : selectedDivisionKeys.length - 1;
    setSelectedDivisionKeys((current) =>
      current.includes(divisionKey)
        ? current.filter((key) => key !== divisionKey)
        : [...current, divisionKey],
    );
    if (!selecting && nextSelectionCount <= 0) {
      setDivisionPickerOpen(true);
    }
  };
  const clearSelectedDivisions = () => {
    setSelectedDivisionKeys([]);
    setDivisionPickerOpen(true);
  };
  const comparePickerVisible =
    mode === "compare" &&
    (divisionPickerOpen || selectedDivisionKeys.length === 0);

  return (
    <section className="court-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
            Points Leaders
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            {mode === "compare"
              ? "Compare divisions by points"
              : "All teams by points"}
          </h2>
        </div>
        <span className="shrink-0 rounded-md bg-slate-950 px-2 py-1 text-xs font-black text-white">
          {badgeText}
        </span>
      </div>

      {loading ? (
        <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
      ) : null}
      {!loading && leaders.length === 0 ? (
        <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
          Registered teams will appear here after the next sync.
        </p>
      ) : null}

      {!loading && leaders.length > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
          {(["overall", "compare"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item);
                if (item === "compare" && selectedDivisionKeys.length === 0)
                  setDivisionPickerOpen(true);
              }}
              className={clsx(
                "min-h-11 rounded-md px-3 text-sm font-black transition active:scale-[0.98]",
                mode === item
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-600",
              )}
            >
              {item === "overall" ? "Overall" : "Compare"}
            </button>
          ))}
        </div>
      ) : null}

      {!loading &&
      leaders.length > 0 &&
      mode === "compare" &&
      selectedDivisions.length > 0 ? (
        <div
          className="mb-3 rounded-lg border border-slate-200 bg-white p-2"
          data-testid="division-compare-summary"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-600">
                Selected divisions
              </p>
              <p className="truncate text-sm font-black text-slate-950">
                {selectedDivisions.length} divisions · {compareLeaders.length}{" "}
                teams
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDivisionPickerOpen((current) => !current)}
                className="min-h-9 rounded-md bg-slate-950 px-3 text-xs font-black text-white"
              >
                {divisionPickerOpen ? "Done" : "Edit"}
              </button>
              <button
                type="button"
                onClick={clearSelectedDivisions}
                className="min-h-9 rounded-md bg-slate-100 px-3 text-xs font-black text-slate-600"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {selectedDivisions.map((division) => (
              <button
                key={division.divisionKey}
                type="button"
                onClick={() => toggleDivision(division.divisionKey)}
                className="inline-flex min-h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-md bg-orange-100 px-2.5 text-xs font-black text-orange-800"
              >
                <span className="truncate">{division.divisionName}</span>
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && leaders.length > 0 && comparePickerVisible ? (
        <div className="mb-3 space-y-2">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={divisionSearch}
              onChange={(event) => setDivisionSearch(event.target.value)}
              placeholder="Search divisions"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
            />
          </label>

          <div
            className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2"
            data-testid="division-compare-options"
          >
            <p className="px-1 pb-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
              {searchedDivisions.length} of {divisionOptions.length} divisions
            </p>
            {searchedDivisions.map((division) => {
              const selected = selectedDivisionKeys.includes(
                division.divisionKey,
              );
              return (
                <button
                  key={division.divisionKey}
                  type="button"
                  onClick={() => toggleDivision(division.divisionKey)}
                  className={clsx(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left transition active:scale-[0.99]",
                    selected
                      ? "bg-slate-950 text-white"
                      : "bg-white text-slate-900",
                  )}
                  data-testid="division-compare-option"
                >
                  <span className="min-w-0 text-sm font-black leading-snug">
                    {division.divisionName}
                  </span>
                  <span
                    className={clsx(
                      "shrink-0 rounded-md px-2 py-1 text-[11px] font-black",
                      selected
                        ? "bg-orange-500 text-white"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {division.teamCount}
                  </span>
                </button>
              );
            })}
            {searchedDivisions.length === 0 ? (
              <p className="rounded-md bg-white p-3 text-sm font-semibold text-slate-600">
                No divisions match that search.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {!loading &&
      leaders.length > 0 &&
      mode === "compare" &&
      selectedDivisionKeys.length === 0 ? (
        <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
          Choose divisions to compare.
        </p>
      ) : null}

      {!loading && displayLeaders.length > 0 ? (
        <div
          className="max-h-[590px] space-y-2 overflow-y-auto pr-1"
          data-testid="points-leaders-list"
        >
          {displayLeaders.map((leader) => (
            <PointLeaderRow key={leader.teamKey} leader={leader} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PointLeaderRow({ leader }: { leader: TeamScoringLeader }) {
  const latestScore = latestPointLeaderScoreLabel(leader);
  return (
    <div
      className="grid grid-cols-[2.6rem_4.1rem_3.35rem_minmax(0,1fr)] items-start gap-1.5 rounded-lg border border-slate-200 bg-white p-2"
      data-testid="points-leader-row"
    >
      <div
        className={clsx(
          "grid h-10 w-10 place-items-center rounded-lg text-sm font-black",
          leader.rank === 1
            ? "bg-orange-500 text-white"
            : "bg-slate-100 text-slate-700",
        )}
      >
        {ordinalRank(leader.rank)}
      </div>
      <div className="rounded-md bg-slate-950 px-2 py-1 text-center text-white">
        <p className="text-lg font-black leading-5">{leader.totalPoints}</p>
        <p className="text-[9px] font-black uppercase tracking-[0.08em] text-orange-300">
          points
        </p>
      </div>
      <div className="rounded-md bg-slate-100 px-1.5 py-1 text-center text-slate-900">
        <p className="text-sm font-black leading-4">
          {teamRecordLabel(leader)}
        </p>
        <p className="text-[8px] font-black uppercase tracking-[0.08em] text-slate-500">
          {leader.ties > 0 ? "W-L-T" : "W-L"}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-slate-950">
          {leader.teamName}
        </p>
        <p className="truncate text-[11px] font-semibold text-slate-500">
          {leader.divisionName}
        </p>
        <p className="truncate text-[10px] font-black text-slate-600">
          {latestScore ?? `${leader.gamesScored} scored games`}
        </p>
      </div>
    </div>
  );
}

function latestPointLeaderScoreLabel(leader: TeamScoringLeader): string | null {
  if (leader.latestScore === null || leader.latestOpponentScore === null)
    return null;
  const opponent = leader.latestOpponentName
    ? ` vs ${leader.latestOpponentName}`
    : "";
  return `Latest: ${leader.latestScore}-${leader.latestOpponentScore}${opponent}`;
}

function FinalResultsSection({
  clientId,
  eventId,
  followedTeams,
}: {
  clientId: string;
  eventId: number | null;
  followedTeams: Team[];
}) {
  const [scope, setScope] = useState<"watched" | "all">("watched");
  const {
    records,
    loading: recordsLoading,
    games: recordGames,
    teams: recordTeams,
  } = useTeamRecords(eventId);
  const resultsQuery = useQuery({
    queryKey: ["results", "all", eventId],
    queryFn: () => CourtWatchApi.results("all", eventId),
    enabled: Boolean(clientId && eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const resultGroups = useMemo(
    () =>
      scope === "all"
        ? (resultsQuery.data ?? []).map((group) => ({
            ...group,
            followedTeamsWithoutPlacement: [],
            hasPostedPlacements: group.rows.length > 0,
          }))
        : finalResultGroupsForFollowedTeams(
            resultsQuery.data ?? [],
            followedTeams,
          ),
    [followedTeams, resultsQuery.data, scope],
  );
  const resultCountLabel = resultsQuery.isLoading
    ? "..."
    : scope === "watched"
      ? `${followedTeams.length} teams`
      : `${resultGroups.length} divisions`;
  const emptyMessage =
    scope === "all"
      ? "Final placements will appear here after official bracket finals are posted."
      : "No followed teams are listed in official final placements yet.";

  return (
    <section className="court-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
            Final Results
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            Gold, silver, bronze by division
          </h2>
        </div>
        <span className="shrink-0 rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">
          {resultCountLabel}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setScope("watched")}
          className={clsx(
            "min-h-10 rounded-md text-sm font-black transition active:scale-95",
            scope === "watched" ? "bg-slate-950 text-white" : "text-slate-600",
          )}
        >
          My divisions
        </button>
        <button
          type="button"
          onClick={() => setScope("all")}
          className={clsx(
            "min-h-10 rounded-md text-sm font-black transition active:scale-95",
            scope === "all" ? "bg-slate-950 text-white" : "text-slate-600",
          )}
        >
          All divisions
        </button>
      </div>

      {resultsQuery.isLoading ? (
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      ) : null}
      {!resultsQuery.isLoading && resultGroups.length === 0 ? (
        <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
          {emptyMessage}
        </p>
      ) : null}

      <div
        className="max-h-[62vh] space-y-3 overflow-y-auto overscroll-contain pb-2 pr-1 md:max-h-[680px]"
        data-testid="final-results-list"
      >
        {resultGroups.map((group) => (
          <DivisionResultCard
            key={group.divisionId}
            group={group}
            records={records}
            games={recordGames}
            teams={recordTeams}
            recordsLoading={recordsLoading}
          />
        ))}
      </div>
    </section>
  );
}

function DivisionResultCard({
  group,
  records,
  games,
  teams,
  recordsLoading,
}: {
  group: FollowedFinalResultGroup;
  records: Map<string, TeamRecord>;
  games: Game[];
  teams: Team[];
  recordsLoading: boolean;
}) {
  const unplacedFollowedTeams = group.followedTeamsWithoutPlacement ?? [];
  const resultStatusLabel =
    !group.hasPostedPlacements && group.rows.length === 0
      ? "Pending"
      : group.isOfficial
        ? "Official"
        : "Bracket final";
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-black leading-tight text-slate-950">
            {group.divisionName}
          </h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {group.gradeLevel ?? "Grade TBD"}{" "}
            {group.level ? `/ ${group.level}` : ""}
          </p>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-md px-2 py-1 text-[10px] font-black uppercase",
            group.rows.length === 0
              ? "bg-amber-100 text-amber-700"
              : group.isOfficial
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-600",
          )}
        >
          {resultStatusLabel}
        </span>
      </div>

      <div className="space-y-2">
        {group.rows.length > 0
          ? group.rows.map((result) => (
              <DivisionResultRow
                key={`${result.divisionId}-${result.placement}`}
                result={result}
                record={resultRecordForTeam(result, records, games, teams)}
                recordsLoading={recordsLoading}
              />
            ))
          : null}
        {unplacedFollowedTeams.map((team) => (
          <FollowedTeamFinalStatusRow
            key={team.id}
            team={team}
            hasPostedPlacements={group.hasPostedPlacements}
            record={followedTeamRecord(team, records, games)}
            recordsLoading={recordsLoading}
          />
        ))}
        {group.rows.length === 0 && unplacedFollowedTeams.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm font-black text-slate-600">
            Final placements not posted yet for this division.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-[11px] font-semibold leading-4 text-slate-500">
          Official schedules and rulings come from tournament staff.
        </p>
        {group.sourceUrl ? (
          <a
            href={group.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-black text-orange-600"
          >
            Source
          </a>
        ) : null}
      </div>
    </article>
  );
}

function FollowedTeamFinalStatusRow({
  team,
  hasPostedPlacements,
  record,
  recordsLoading,
}: {
  team: Team;
  hasPostedPlacements: boolean;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-200 text-slate-600">
        <Users className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase text-slate-500">
          Followed team
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-black text-slate-950">
            {teamDisplayName(team)}
          </p>
          <TeamRecordBadge record={record} loading={recordsLoading} />
        </div>
        <p className="mt-1 text-[11px] font-black text-slate-500">
          {hasPostedPlacements
            ? "Not listed in posted gold, silver, or bronze."
            : "Final placement pending."}
        </p>
      </div>
    </div>
  );
}

function DivisionResultRow({
  result,
  record,
  recordsLoading,
}: {
  result: DivisionResult;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
}) {
  const isChampion = result.placement === 1;
  const displayedRecord = resultRecordFromOfficialRow(result) ?? record;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
      <div
        className={clsx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white",
          result.placement === 1
            ? "bg-orange-500"
            : result.placement === 2
              ? "bg-slate-500"
              : "bg-amber-700",
        )}
      >
        {isChampion ? (
          <Trophy className="h-5 w-5" />
        ) : (
          <Medal className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase text-slate-500">
          {resultPlacementLabel(result)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-black text-slate-950">
            {result.teamNameSnapshot}
          </p>
          <TeamRecordBadge record={displayedRecord} loading={recordsLoading} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function ScheduleScreen({
  games,
  programs,
  todayKey,
  timezone,
  eventId,
}: {
  games: Game[];
  programs: ProgramSummary[];
  todayKey: string;
  timezone: string;
  eventId: number | null;
}) {
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courtFilter, setCourtFilter] = useState("");
  const { records, loading: recordsLoading } = useTeamRecords(eventId);
  const followedCount = programs.reduce(
    (count, program) => count + program.teams.length,
    0,
  );
  const watchedTeamsByProgram = useMemo(
    () =>
      new Map(
        programs.map((program) => [
          program.program.id,
          new Set(program.teams.map((team) => team.id)),
        ]),
      ),
    [programs],
  );
  const courts = Array.from(
    new Set(games.map((game) => game.courtName).filter(Boolean)),
  ).sort();

  const filteredGames = games.filter((game) => {
    if (programFilter !== "all") {
      const teamIds = watchedTeamsByProgram.get(programFilter);
      if (
        !teamIds?.has(game.homeTeamId ?? "") &&
        !teamIds?.has(game.awayTeamId ?? "")
      )
        return false;
    }
    if (statusFilter !== "all" && game.status !== statusFilter) return false;
    if (courtFilter && game.courtName !== courtFilter) return false;
    return true;
  });

  const groups = groupGamesByDate(filteredGames, todayKey, timezone);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/8 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
          <Search className="h-4 w-4 text-orange-300" />
          Schedule Filters
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          <FilterButton
            active={programFilter === "all"}
            onClick={() => setProgramFilter("all")}
          >
            All watched
          </FilterButton>
          {programs.map((program) => (
            <FilterButton
              key={program.program.id}
              active={programFilter === program.program.id}
              onClick={() => setProgramFilter(program.program.id)}
            >
              {program.program.programName}
            </FilterButton>
          ))}
        </div>
        <div className="mt-2 no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {["all", "playing_now", "upcoming", "final", "schedule_changed"].map(
            (status) => (
              <FilterButton
                key={status}
                active={statusFilter === status}
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "All status" : labelStatus(status)}
              </FilterButton>
            ),
          )}
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
        <section key={group.date} className="space-y-2">
          <h2 className="px-1 text-sm font-black uppercase tracking-[0.16em] text-orange-300">
            {group.label}
          </h2>
          {group.games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              records={records}
              recordsLoading={recordsLoading}
            />
          ))}
        </section>
      ))}
      {groups.length === 0 ? (
        <section className="court-card p-4">
          <h2 className="text-xl font-black text-slate-950">
            No followed-team games yet
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {followedCount > 0
              ? "Court Watch AAU is waiting for the real Exposure schedule feed for your selected teams. No placeholder games are shown."
              : "Use Teams search to follow the registered teams you want on this schedule."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-10 shrink-0 rounded-lg px-3 text-sm font-black transition active:scale-95",
        active
          ? "bg-orange-500 text-white"
          : "border border-white/12 bg-slate-950 text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function GameRow({
  game,
  records,
  recordsLoading,
}: {
  game: Game;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
}) {
  const bracketUrl = bracketUrlFromGame(game);
  const matchup = gameMatchupDisplayName(game);
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={game.status} />
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
              {game.gameType ?? "Pool"}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">{matchup}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {formatGameDate(game.startsAt)}
          </p>
          <GameRecordsLine
            game={game}
            records={records}
            loading={recordsLoading}
          />
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
            <p className="text-[11px] font-bold">
              {game.courtName ?? "Court TBD"}
            </p>
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
        <a
          href={bracketUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg bg-slate-100 px-3 text-sm font-black text-slate-800"
        >
          <Trophy className="h-4 w-4 text-orange-500" />
          Official bracket
          <ChevronRight className="h-4 w-4" />
        </a>
      ) : null}
    </article>
  );
}

function TeamsScreen({
  dashboard,
  eventId,
  clientId,
}: {
  dashboard: DashboardResponse;
  eventId: number | null;
  clientId: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const {
    records,
    loading: recordsLoading,
    games: recordGames,
    teams: recordTeams,
  } = useTeamRecords(eventId);
  const teamsQuery = useQuery({
    queryKey: ["teams", deferredSearch, eventId],
    queryFn: () => CourtWatchApi.teams(deferredSearch, eventId),
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const allTeamsQuery = useQuery({
    queryKey: ["teams", "registered-totals", eventId],
    queryFn: () => CourtWatchApi.teams("", eventId),
    enabled: Boolean(deferredSearch),
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const dashboardFollowedTeams = useMemo(
    () =>
      (dashboard.programs[0]?.teams ?? []).map((team) => ({
        ...team,
        isFollowed: true,
      })),
    [dashboard.programs],
  );
  const observedFollowedTeams = useMemo(
    () =>
      mergeTeamLists(
        recordTeams,
        teamsQuery.data ?? [],
        dashboardFollowedTeams,
      ),
    [dashboardFollowedTeams, recordTeams, teamsQuery.data],
  );
  const { storedFollowedTeams, rememberFollowedTeam, forgetFollowedTeamById } =
    useStoredFollowedTeams(clientId, eventId, observedFollowedTeams);
  const registeredTeamPool = useMemo(
    () => mergeTeamLists(recordTeams, teamsQuery.data ?? []),
    [recordTeams, teamsQuery.data],
  );
  const trustedRegisteredTeamPool = useMemo(
    () => teamsWithTrustedFollowState(registeredTeamPool, storedFollowedTeams),
    [registeredTeamPool, storedFollowedTeams],
  );
  const followStateTeams = useMemo(
    () => mergeTeamLists(trustedRegisteredTeamPool, storedFollowedTeams),
    [storedFollowedTeams, trustedRegisteredTeamPool],
  );
  const selectedProgram = useMemo(
    () =>
      programWithRegisteredFollows(
        dashboard.programs[0],
        followStateTeams,
        recordGames,
        records,
      ),
    [dashboard.programs, followStateTeams, recordGames, records],
  );
  const refreshSelection = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["games"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["results"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
    queryClient.invalidateQueries({ queryKey: ["points-leaders"] });
  };
  const knownTeamsById = useMemo(
    () => new Map(followStateTeams.map((team) => [team.id, team])),
    [followStateTeams],
  );
  const followTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.followTeam(teamId),
    onSuccess: (_match, teamId) => {
      rememberFollowedTeam(knownTeamsById.get(teamId));
      refreshSelection();
    },
  });
  const unfollowTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.unfollowTeam(teamId),
    onSuccess: (_unused, teamId) => {
      forgetFollowedTeamById(teamId);
      refreshSelection();
    },
  });
  const teams = useMemo(() => {
    const matchingStoredTeams = deferredSearch
      ? storedFollowedTeams.filter((team) =>
          teamMatchesSearch(team, deferredSearch),
        )
      : storedFollowedTeams;
    return mergeTeamLists(trustedRegisteredTeamPool, matchingStoredTeams);
  }, [deferredSearch, storedFollowedTeams, trustedRegisteredTeamPool]);
  const registeredTeams = deferredSearch
    ? allTeamsQuery.data?.length
      ? teamsWithTrustedFollowState(allTeamsQuery.data, storedFollowedTeams)
      : teams
    : teams;
  const registeredCountLoading = deferredSearch
    ? allTeamsQuery.isLoading && teams.length === 0
    : teamsQuery.isLoading;
  const registeredCountLabel =
    deferredSearch && !allTeamsQuery.data?.length
      ? `${teams.length} results`
      : `${registeredTeams.length} registered`;
  const divisionTotals = useMemo(
    () => divisionTotalsForTeams(registeredTeams),
    [registeredTeams],
  );
  const pendingTeamId = String(
    followTeam.variables ?? unfollowTeam.variables ?? "",
  );
  const focusedTeam =
    selectedProgram?.teams.find((team) => team.id === focusedTeamId) ?? null;

  return (
    <div className="space-y-4">
      <section className="court-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
              Team Selection
            </p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {selectedProgram?.teams.length ?? 0} teams followed
            </h2>
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
            placeholder="Search registered team"
            className="min-h-11 flex-1 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
      </section>

      {selectedProgram && selectedProgram.teams.length > 0 ? (
        <section className="court-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-950">Following</h2>
            <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">
              {selectedProgram.teams.length} active
            </span>
          </div>
          <div className="space-y-2">
            {selectedProgram.teams.map((team) => (
              <FollowedTeamRow
                key={team.id}
                team={team}
                eventId={eventId}
                record={teamRecordForTeam(team, records)}
                recordsLoading={recordsLoading}
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

      {focusedTeam ? (
        <TeamFocusPanel
          team={focusedTeam}
          eventId={eventId}
          record={teamRecordForTeam(focusedTeam, records)}
          records={records}
          recordsLoading={recordsLoading}
        />
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-orange-300">
            {deferredSearch ? "Search Results" : "Registered Teams"}
          </h2>
          <span className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs font-black text-white">
            {registeredCountLoading ? "..." : registeredCountLabel}
          </span>
        </div>
        <DivisionTotalsPanel
          totals={divisionTotals}
          loading={registeredCountLoading}
        />
        {teamsQuery.isLoading ? (
          <div className="h-28 animate-pulse rounded-lg bg-white/12" />
        ) : null}
        {!teamsQuery.isLoading && teams.length === 0 ? (
          <div className="court-card p-4">
            <h3 className="text-lg font-black text-slate-950">
              No matches found
            </h3>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Try a team name, club name, or division.
            </p>
          </div>
        ) : null}
        {teams.map((team) => (
          <TeamSearchCard
            key={team.id}
            team={team}
            record={teamRecordForTeam(team, records)}
            recordsLoading={recordsLoading}
            onFollow={() => followTeam.mutate(team.id)}
            onUnfollow={() => unfollowTeam.mutate(team.id)}
            pending={
              (followTeam.isPending || unfollowTeam.isPending) &&
              pendingTeamId === team.id
            }
          />
        ))}
      </section>
    </div>
  );
}

type DivisionTotal = {
  divisionName: string;
  count: number;
};

type DivisionCompareOption = {
  divisionKey: string;
  divisionIds: string[];
  divisionName: string;
  teamCount: number;
  totalPoints: number;
};

function useTeamRecords(eventId: number | null): {
  records: Map<string, TeamRecord>;
  loading: boolean;
  games: Game[];
  teams: Team[];
} {
  const allGamesQuery = useQuery({
    queryKey: ["games", "all", eventId],
    queryFn: () => CourtWatchApi.allGames(eventId),
    enabled: Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const teamsQuery = useQuery({
    queryKey: ["teams", "all", eventId],
    queryFn: () => CourtWatchApi.teams("", eventId),
    enabled: Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const records = useMemo(
    () => buildTeamRecordMap(allGamesQuery.data ?? [], teamsQuery.data ?? []),
    [allGamesQuery.data, teamsQuery.data],
  );
  return {
    records,
    loading: allGamesQuery.isLoading || teamsQuery.isLoading,
    games: allGamesQuery.data ?? [],
    teams: teamsQuery.data ?? [],
  };
}

function useStoredFollowedTeams(
  clientId: string | null,
  eventId: number | null,
  observedTeams: Team[],
): {
  storedFollowedTeams: Team[];
  rememberFollowedTeam: (team: Team | undefined) => void;
  forgetFollowedTeamById: (teamId: string) => void;
} {
  const [storedFollowedTeams, setStoredFollowedTeams] = useState<Team[]>([]);
  const observedFollowedSignature = useMemo(
    () =>
      observedTeams
        .filter((team) => team.isFollowed)
        .map((team) => `${team.id}:${team.followerCount ?? ""}`)
        .sort()
        .join("|"),
    [observedTeams],
  );

  useEffect(() => {
    setStoredFollowedTeams(loadStoredFollowedTeams(clientId, eventId));
  }, [clientId, eventId]);

  useEffect(() => {
    if (!clientId || !eventId || observedFollowedSignature.length === 0) return;
    setStoredFollowedTeams(
      mergeStoredFollowedTeams(clientId, eventId, observedTeams, {
        onlyExistingWhenStored: true,
      }),
    );
  }, [clientId, eventId, observedFollowedSignature, observedTeams]);

  return {
    storedFollowedTeams,
    rememberFollowedTeam: (team) =>
      setStoredFollowedTeams(
        rememberStoredFollowedTeam(clientId, eventId, team),
      ),
    forgetFollowedTeamById: (teamId) =>
      setStoredFollowedTeams(
        forgetStoredFollowedTeam(clientId, eventId, teamId),
      ),
  };
}

function teamsWithTrustedFollowState(
  teams: Team[],
  storedFollowedTeams: Team[],
): Team[] {
  if (storedFollowedTeams.length === 0) return teams;
  const storedFollowedIds = new Set(storedFollowedTeams.map((team) => team.id));
  return teams.map((team) => ({
    ...team,
    isFollowed: storedFollowedIds.has(team.id),
  }));
}

function DivisionTotalsPanel({
  totals,
  loading,
}: {
  totals: DivisionTotal[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-lg bg-white/12" />;
  }

  if (totals.length === 0) return null;

  return (
    <details className="overflow-hidden rounded-lg border border-white/12 bg-white/8 text-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-black">
        <span>Division totals</span>
        <span className="rounded-md bg-orange-500 px-2 py-1 text-xs text-white">
          {totals.length} divisions
        </span>
      </summary>
      <div className="max-h-72 space-y-1 overflow-y-auto border-t border-white/10 p-2">
        {totals.map((division) => (
          <div
            key={division.divisionName}
            className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-slate-900"
          >
            <span className="min-w-0 text-sm font-black leading-snug">
              {division.divisionName}
            </span>
            <span className="shrink-0 rounded-md bg-slate-950 px-2 py-1 text-xs font-black text-white">
              {division.count}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function FollowedTeamRow({
  team,
  eventId,
  record,
  recordsLoading,
  focused,
  onFocus,
  onUnfollow,
  pending,
}: {
  team: ProgramSummary["teams"][number];
  eventId: number | null;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
  focused: boolean;
  onFocus: () => void;
  onUnfollow: () => void;
  pending: boolean;
}) {
  const displayName = teamDisplayName(team);
  return (
    <article
      className={clsx(
        "rounded-lg border bg-white p-3",
        focused
          ? "border-orange-400 ring-2 ring-orange-100"
          : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-slate-950">{displayName}</p>
            <FollowerCountBadge count={team.followerCount ?? 0} />
            <TeamRecordBadge record={record} loading={recordsLoading} />
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            {team.divisionName ?? "Division TBD"}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {team.gender ?? "Any"} / {team.gradeLevel ?? "Grade TBD"} /{" "}
            {team.level ?? "Level TBD"}
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
        <Metric
          label="Next"
          value={
            team.nextGame
              ? `${team.nextGame.scheduledTime} ${team.nextGame.courtName ?? "Court TBD"}`
              : "TBD"
          }
        />
        <Metric
          label="Last"
          value={team.lastResult ? scoreSummary(team.lastResult) : "No result"}
        />
      </div>
      <OfficialTeamPageLink sourceUrl={team.sourceUrl} />
      <TeamBracketLink team={team} eventId={eventId} />
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

function TeamBracketLink({
  team,
  eventId,
}: {
  team: ProgramSummary["teams"][number];
  eventId: number | null;
}) {
  const divisionGamesQuery = useQuery({
    queryKey: ["division-games", team.divisionId, eventId],
    queryFn: () =>
      CourtWatchApi.games(
        `?scope=division&division=${encodeURIComponent(team.divisionId ?? "")}`,
        eventId,
      ),
    enabled: Boolean(team.divisionId),
    staleTime: 60_000,
  });
  const bracketUrl = (divisionGamesQuery.data ?? [])
    .map(divisionBracketUrlFromGame)
    .find(Boolean);

  if (divisionGamesQuery.isLoading) {
    return <div className="mt-3 h-10 animate-pulse rounded-lg bg-slate-100" />;
  }

  if (!bracketUrl) {
    return (
      <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">
        Official bracket not posted yet
      </p>
    );
  }

  return (
    <a
      href={bracketUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-orange-50 px-3 text-sm font-black text-orange-700 active:scale-[0.99]"
    >
      <Trophy className="h-4 w-4" />
      Official bracket
      <ChevronRight className="h-4 w-4" />
    </a>
  );
}

function TeamFocusPanel({
  team,
  eventId,
  record,
  records,
  recordsLoading,
}: {
  team: ProgramSummary["teams"][number];
  eventId: number | null;
  record: TeamRecord | undefined;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
}) {
  const divisionGamesQuery = useQuery({
    queryKey: ["division-games", team.divisionId, eventId],
    queryFn: () =>
      CourtWatchApi.games(
        `?scope=division&division=${encodeURIComponent(team.divisionId ?? "")}`,
        eventId,
      ),
    enabled: Boolean(team.divisionId),
  });
  const divisionGames = divisionGamesQuery.data ?? [];
  const teamGames = divisionGames.filter((game) =>
    gameBelongsToTeam(game, team),
  );
  const bracketGames = divisionGames.filter(isBracketGame);
  const bracketUrl = divisionGames
    .map(divisionBracketUrlFromGame)
    .find(Boolean);
  const displayName = teamDisplayName(team);

  return (
    <section className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
            Focused Team
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">
            {displayName}
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            {team.divisionName ?? "Division TBD"}
          </p>
          <div className="mt-2">
            <TeamRecordBadge record={record} loading={recordsLoading} />
          </div>
          <OfficialTeamPageLink sourceUrl={team.sourceUrl} />
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-orange-300">
          <Trophy className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Next court" value={team.nextGame?.courtName ?? "TBD"} />
        <Metric
          label="Bracket games"
          value={
            divisionGamesQuery.isLoading ? "..." : String(bracketGames.length)
          }
        />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-950">Team Schedule</h3>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
            {teamGames.length} games
          </span>
        </div>
        <MiniGameList
          games={teamGames}
          loading={divisionGamesQuery.isLoading}
          records={records}
          recordsLoading={recordsLoading}
          empty="No official games published for this team yet."
        />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-950">
            Division Bracket
          </h3>
          {bracketUrl ? (
            <a
              href={bracketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-orange-500 px-3 text-xs font-black text-white"
            >
              Official
              <ChevronRight className="h-4 w-4" />
            </a>
          ) : null}
        </div>
        <MiniGameList
          games={bracketGames}
          loading={divisionGamesQuery.isLoading}
          records={records}
          recordsLoading={recordsLoading}
          empty="No bracket games published for this division yet."
        />
      </div>
    </section>
  );
}

function MiniGameList({
  games,
  loading,
  records,
  recordsLoading,
  empty,
}: {
  games: Game[];
  loading: boolean;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
  empty: string;
}) {
  if (loading)
    return <div className="h-24 animate-pulse rounded-lg bg-slate-100" />;
  if (games.length === 0)
    return (
      <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
        {empty}
      </p>
    );

  return (
    <div className="space-y-2">
      {games.map((game) => (
        <article
          key={game.id}
          className="rounded-lg border border-slate-200 bg-white p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={game.status} />
                <span className="truncate text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                  {game.gameType ?? "Pool"}
                </span>
              </div>
              <p className="mt-2 text-sm font-black text-slate-950">
                {gameMatchupDisplayName(game)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {formatGameDate(game.startsAt)}
              </p>
              <GameRecordsLine
                game={game}
                records={records}
                loading={recordsLoading}
              />
            </div>
            <div className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-center text-white">
              <p className="text-sm font-black">{game.scheduledTime}</p>
              <p className="text-[11px] font-bold">
                {game.courtName ?? "Court TBD"}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function TeamSearchCard({
  team,
  record,
  recordsLoading,
  onFollow,
  onUnfollow,
  pending,
}: {
  team: Team;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  pending: boolean;
}) {
  const followed = Boolean(team.isFollowed);
  return (
    <article className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-black text-slate-950">
              {teamDisplayName(team)}
            </p>
            <FollowerCountBadge count={team.followerCount ?? 0} />
            <TeamRecordBadge record={record} loading={recordsLoading} />
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            {team.divisionName ?? "Division TBD"}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {team.gender ?? "Any"} / {team.gradeLevel ?? "Grade TBD"} /{" "}
            {team.level ?? "Level TBD"}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={followed ? onUnfollow : onFollow}
          className={clsx(
            "min-h-11 shrink-0 rounded-lg px-4 text-sm font-black active:scale-95 disabled:opacity-60",
            followed
              ? "border border-slate-200 bg-white text-slate-800"
              : "bg-orange-500 text-white",
          )}
        >
          {pending ? "..." : followed ? "Following" : "Follow"}
        </button>
      </div>
      <OfficialTeamPageLink sourceUrl={team.sourceUrl} />
    </article>
  );
}

function FollowerCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 rounded-md bg-orange-100 px-2 py-1 text-[11px] font-black text-orange-700">
      {count} following
    </span>
  );
}

function TeamRecordBadge({
  record,
  loading = false,
}: {
  record?: TeamRecord;
  loading?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">
      <span className="text-slate-950">{recordText(record, loading)}</span>
      <span className="uppercase text-slate-500">{recordCaption(record)}</span>
    </span>
  );
}

function GameRecordsLine({
  game,
  records,
  loading = false,
}: {
  game: Game;
  records: Map<string, TeamRecord>;
  loading?: boolean;
}) {
  const teams = [
    {
      id: game.homeTeamId,
      name: gameTeamDisplayName(game.homeTeamNameSnapshot, game, "Home"),
    },
    {
      id: game.awayTeamId,
      name: gameTeamDisplayName(game.awayTeamNameSnapshot, game, "Away"),
    },
  ].filter((team): team is { id: string; name: string } => Boolean(team.id));

  if (teams.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-black text-slate-600">
      <span className="uppercase tracking-[0.12em] text-slate-400">
        Records
      </span>
      {teams.map((team) => {
        const record =
          team.id === game.homeTeamId
            ? (game.homeTeamRecord ?? records.get(team.id))
            : (game.awayTeamRecord ?? records.get(team.id));
        return (
          <span
            key={team.id}
            className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 text-slate-700"
          >
            <span className="max-w-[11rem] truncate">{team.name}</span>
            <span className="shrink-0 text-slate-950">
              {recordText(record, loading)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function OfficialTeamPageLink({
  sourceUrl,
}: {
  sourceUrl: string | null | undefined;
}) {
  if (!sourceUrl) return null;

  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex items-center gap-1 text-sm font-black text-orange-600"
    >
      Official team page
      <ChevronRight className="h-4 w-4" />
    </a>
  );
}

function AlertsScreen({
  alerts,
  games,
}: {
  alerts: GameChangeEvent[];
  games: Game[];
}) {
  return (
    <section className="court-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-950">Alerts</h2>
        <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">
          {alerts.length} recent
        </span>
      </div>
      <AlertList alerts={alerts} games={games} />
    </section>
  );
}

function AlertList({
  alerts,
  games = [],
  compact = false,
}: {
  alerts: GameChangeEvent[];
  games?: Game[];
  compact?: boolean;
}) {
  const gamesById = useMemo(
    () => new Map(games.map((game) => [game.id, game])),
    [games],
  );

  if (alerts.length === 0) {
    return (
      <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
        No alerts yet. Court Watch AAU is monitoring for changes.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const game = alert.gameId
          ? (gamesById.get(alert.gameId) ?? null)
          : null;
        const display = alertDisplay(alert, game);
        return (
          <article
            key={alert.id}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-500 text-white">
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-orange-600">
                    {labelStatus(alert.eventType)}
                  </p>
                  <span className="text-[11px] font-bold text-slate-400">
                    {formatShortTime(alert.createdAt)}
                  </span>
                </div>
                <p
                  className={clsx(
                    "mt-1 font-black leading-snug text-slate-950",
                    compact ? "text-sm" : "text-base",
                  )}
                >
                  {display.headline}
                </p>
                {display.meta ? (
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                    {display.meta}
                  </p>
                ) : null}
                {!compact && display.detail ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                    {display.detail}
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SettingsScreen({
  dashboard,
  onRefresh,
  eventId,
}: {
  dashboard: DashboardResponse;
  onRefresh: () => void;
  eventId: number | null;
}) {
  const [adminSecret, setAdminSecret] = useState("");
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const syncMutation = useMutation({
    mutationFn: () => CourtWatchApi.syncNow(adminSecret, eventId),
    onSuccess: (result) => {
      setAdminMessage(
        `Sync complete: ${result.teamsCount} teams, ${result.gamesCount} games`,
      );
      onRefresh();
    },
    onError: (error) =>
      setAdminMessage(error instanceof Error ? error.message : "Sync failed"),
  });

  const subscribe = async () => {
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
      if (!publicKey) {
        setPushMessage("VAPID public key is not configured yet.");
        return;
      }
      const subscription = await requestPushSubscription(publicKey);
      await CourtWatchApi.subscribePush(
        subscription,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setPushMessage("Push notifications enabled for this device.");
    } catch (error) {
      setPushMessage(
        error instanceof Error
          ? error.message
          : "Unable to enable notifications.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <section className="court-card p-4">
        <h2 className="text-2xl font-black text-slate-950">Settings</h2>
        <div className="mt-4 space-y-3">
          <SettingRow
            icon={Bell}
            title="Notifications"
            value="Game changes, scores, courts, brackets"
          />
          <SettingRow
            icon={Clock3}
            title="Refresh frequency"
            value="60s during active tournament hours"
          />
          <SettingRow
            icon={Activity}
            title="Source status"
            value={`${dashboard.sourceStatus.source} / ${dashboard.sourceStatus.status}`}
          />
          <SettingRow icon={Smartphone} title="API URL" value={apiBaseUrl()} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <SettingsLink href="/install" title="Install guide" />
          <SettingsLink href="/support" title="Support" />
          <SettingsLink href="/privacy" title="Privacy policy" />
          <SettingsLink href="/terms" title="Terms" />
        </div>
        <button
          type="button"
          onClick={subscribe}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-black text-white active:scale-[0.99]"
        >
          <Bell className="h-4 w-4" />
          Enable Push Notifications
        </button>
        {pushMessage ? (
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {pushMessage}
          </p>
        ) : null}
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
          <RefreshCcw
            className={clsx(
              "h-4 w-4",
              syncMutation.isPending && "animate-spin",
            )}
          />
          Sync Now
        </button>
        {adminMessage ? (
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {adminMessage}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-white/12 bg-white/8 p-4 text-sm font-medium leading-6 text-slate-200">
        {dashboard.disclaimer}
      </section>
    </div>
  );
}

function SettingsLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      href={href}
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-950"
    >
      <span className="inline-flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-orange-500" />
        {title}
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </a>
  );
}

function SettingRow({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
}) {
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

function BottomTabs({
  activeTab,
  setActiveTab,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}) {
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
                active ? "bg-orange-500 text-white" : "text-slate-300",
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
  return (
    <span
      className={clsx(
        "rounded-md px-2 py-1 text-[11px] font-black uppercase",
        tone,
      )}
    >
      {label}
    </span>
  );
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

function NoTournamentEvents() {
  return (
    <section className="court-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-950 text-orange-300">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-950">
            No public tournaments found
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
            No upcoming tournaments with public registered-team data were found
            in the next six months.
          </p>
        </div>
      </div>
    </section>
  );
}

function useTournamentTodayKey(timeZone: string): string {
  const [todayKey, setTodayKey] = useState(() =>
    dateKeyInTimeZone(new Date(), timeZone),
  );

  useEffect(() => {
    const update = () => setTodayKey(dateKeyInTimeZone(new Date(), timeZone));
    update();
    const intervalId = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timeZone]);

  return todayKey;
}

function useLiveStatusNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const update = () => setNow(new Date());
    const intervalId = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return now;
}

function dataRefetchIntervalForEvent(
  event: Pick<TournamentEvent, "startDate" | "endDate">,
  todayKey: string,
): number {
  return todayKey >= event.startDate && todayKey <= event.endDate
    ? LIVE_DATA_REFETCH_MS
    : PASSIVE_DATA_REFETCH_MS;
}

function groupGamesByDate(games: Game[], todayKey: string, timeZone: string) {
  const grouped = new Map<string, Game[]>();
  for (const game of games) {
    const key = game.scheduledDate;
    grouped.set(key, [...(grouped.get(key) ?? []), game]);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, groupGames]) => ({
      date,
      label: scheduleDateSectionLabel(date, todayKey, timeZone),
      games: groupGames.sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      ),
    }));
}

function divisionTotalsForTeams(teams: Team[]): DivisionTotal[] {
  const counts = new Map<string, number>();
  for (const team of teams) {
    const divisionName = team.divisionName?.trim() || "Division TBD";
    counts.set(divisionName, (counts.get(divisionName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([divisionName, count]) => ({ divisionName, count }))
    .sort((left, right) =>
      divisionSortKey(left.divisionName).localeCompare(
        divisionSortKey(right.divisionName),
        "en-US",
        { numeric: true, sensitivity: "base" },
      ),
    );
}

function divisionCompareOptions(
  leaders: TeamScoringLeader[],
): DivisionCompareOption[] {
  const divisions = new Map<string, DivisionCompareOption>();
  for (const leader of leaders) {
    if (!leader.divisionId) continue;
    const divisionKey = stableDivisionKey(leader.divisionName);
    const existing = divisions.get(divisionKey);
    if (existing) {
      existing.teamCount += 1;
      existing.totalPoints += leader.totalPoints;
      if (!existing.divisionIds.includes(leader.divisionId))
        existing.divisionIds.push(leader.divisionId);
      continue;
    }
    divisions.set(divisionKey, {
      divisionKey,
      divisionIds: [leader.divisionId],
      divisionName: leader.divisionName,
      teamCount: 1,
      totalPoints: leader.totalPoints,
    });
  }
  return Array.from(divisions.values()).sort((left, right) => {
    return (
      divisionSortKey(left.divisionName).localeCompare(
        divisionSortKey(right.divisionName),
        "en-US",
        { numeric: true, sensitivity: "base" },
      ) || right.totalPoints - left.totalPoints
    );
  });
}

function buildTeamRecordMap(
  games: Game[],
  teams: Team[],
): Map<string, TeamRecord> {
  const serverRecordTeamIds = new Set<string>();
  const records = new Map<string, TeamRecord>();
  for (const team of teams) {
    if (!team.record) continue;
    if (team.record.gamesSeen <= 0 && team.record.gamesScored <= 0) continue;
    records.set(team.id, team.record);
    serverRecordTeamIds.add(team.id);
  }

  const leaders = buildTeamScoringLeaders(games, teams, {
    includeUnscoredTeams: true,
  });
  for (const leader of leaders) {
    if (!leader.teamId) continue;
    if (records.has(leader.teamId)) continue;
    if (leader.gamesScored <= 0) continue;
    records.set(leader.teamId, {
      wins: leader.wins,
      losses: leader.losses,
      ties: leader.ties,
      gamesScored: leader.gamesScored,
      totalPoints: leader.totalPoints,
      finalGames: 0,
      gamesSeen: 0,
    });
  }
  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      if (serverRecordTeamIds.has(teamId)) continue;
      const record = records.get(teamId);
      if (!record) continue;
      record.gamesSeen += 1;
      if (game.status === "final") record.finalGames += 1;
    }
  }
  return records;
}

function teamRecordForTeam(
  team: Pick<Team, "id" | "record">,
  records: Map<string, TeamRecord>,
): TeamRecord | undefined {
  const serverRecord = team.record;
  const computedRecord = records.get(team.id);
  if (hasRecordActivity(serverRecord)) return serverRecord;
  if (hasRecordActivity(computedRecord)) return computedRecord;
  return undefined;
}

function resultRecordForTeam(
  result: Pick<
    DivisionResult,
    | "divisionId"
    | "rawJson"
    | "record"
    | "teamId"
    | "teamNameSnapshot"
    | "teamSourceUrl"
  >,
  records: Map<string, TeamRecord>,
  games: Game[],
  teams: Team[],
): TeamRecord | undefined {
  if (hasRecordActivity(result.record)) return result.record;

  const officialRecord = resultRecordFromOfficialRow(result);
  if (hasRecordActivity(officialRecord)) return officialRecord;

  if (result.teamId) {
    const storedRecord = records.get(result.teamId);
    if (hasRecordActivity(storedRecord)) return storedRecord;

    const gameRecord = recordFromGamesForTeamId(result.teamId, games);
    if (hasRecordActivity(gameRecord)) return gameRecord;
  }

  const matchedTeam = findResultTeam(result, teams);
  if (matchedTeam) {
    const matchedRecord = teamRecordForTeam(matchedTeam, records);
    if (hasRecordActivity(matchedRecord)) return matchedRecord;

    const matchedGameRecord = recordFromGamesForTeamId(matchedTeam.id, games);
    if (hasRecordActivity(matchedGameRecord)) return matchedGameRecord;
  }

  const namedRecord = recordFromGamesForTeamName(result, games);
  return hasRecordActivity(namedRecord) ? namedRecord : undefined;
}

function followedTeamRecord(
  team: Team,
  records: Map<string, TeamRecord>,
  games: Game[],
): TeamRecord | undefined {
  const storedRecord = teamRecordForTeam(team, records);
  if (hasRecordActivity(storedRecord)) return storedRecord;

  const gameRecord = recordFromGamesForTeamId(team.id, games);
  return hasRecordActivity(gameRecord) ? gameRecord : undefined;
}

function resultRecordFromOfficialRow(
  result: Pick<DivisionResult, "rawJson">,
): TeamRecord | undefined {
  const raw = result.rawJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const wins = numberFromUnknown(
    (raw as Record<string, unknown>).Wins ??
      (raw as Record<string, unknown>).wins,
  );
  const losses = numberFromUnknown(
    (raw as Record<string, unknown>).Losses ??
      (raw as Record<string, unknown>).losses,
  );
  const ties = numberFromUnknown(
    (raw as Record<string, unknown>).Ties ??
      (raw as Record<string, unknown>).ties,
  );
  if (wins === null && losses === null && ties === null) return undefined;
  const totalPoints =
    numberFromUnknown(
      (raw as Record<string, unknown>).PointsScored ??
        (raw as Record<string, unknown>).pointsScored ??
        (raw as Record<string, unknown>).TotalPoints ??
        (raw as Record<string, unknown>).totalPoints,
    ) ?? 0;
  const normalizedWins = wins ?? 0;
  const normalizedLosses = losses ?? 0;
  const normalizedTies = ties ?? 0;
  const gamesScored = normalizedWins + normalizedLosses + normalizedTies;
  return {
    wins: normalizedWins,
    losses: normalizedLosses,
    ties: normalizedTies,
    gamesScored,
    totalPoints,
    finalGames: gamesScored,
    gamesSeen: gamesScored,
  };
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function findResultTeam(
  result: Pick<
    DivisionResult,
    "divisionId" | "teamNameSnapshot" | "teamSourceUrl"
  >,
  teams: Team[],
): Team | undefined {
  if (result.teamSourceUrl) {
    const bySourceUrl = teams.find(
      (team) =>
        normalizeUrl(team.sourceUrl) === normalizeUrl(result.teamSourceUrl),
    );
    if (bySourceUrl) return bySourceUrl;
  }

  const normalizedName = normalizeTeamMatchName(result.teamNameSnapshot);
  return teams.find(
    (team) =>
      team.divisionId === result.divisionId &&
      normalizeTeamMatchName(teamDisplayName(team)) === normalizedName,
  );
}

function recordFromGamesForTeamId(
  teamId: string,
  games: Game[],
): TeamRecord | undefined {
  return recordFromGames(
    games.filter(
      (game) =>
        game.status === "final" &&
        (game.homeTeamId === teamId || game.awayTeamId === teamId),
    ),
    (game) => (game.homeTeamId === teamId ? "home" : "away"),
  );
}

function recordFromGamesForTeamName(
  result: Pick<DivisionResult, "divisionId" | "teamNameSnapshot">,
  games: Game[],
): TeamRecord | undefined {
  const normalizedName = normalizeTeamMatchName(result.teamNameSnapshot);
  return recordFromGames(
    games.filter(
      (game) =>
        game.status === "final" &&
        game.divisionId === result.divisionId &&
        (normalizeTeamMatchName(game.homeTeamNameSnapshot) === normalizedName ||
          normalizeTeamMatchName(game.awayTeamNameSnapshot) === normalizedName),
    ),
    (game) =>
      normalizeTeamMatchName(game.homeTeamNameSnapshot) === normalizedName
        ? "home"
        : "away",
  );
}

function recordFromGames(
  games: Game[],
  sideForGame: (game: Game) => "home" | "away",
): TeamRecord | undefined {
  if (games.length === 0) return undefined;
  const record: TeamRecord = {
    wins: 0,
    losses: 0,
    ties: 0,
    gamesScored: 0,
    totalPoints: 0,
    finalGames: 0,
    gamesSeen: games.length,
  };

  for (const game of games) {
    const side = sideForGame(game);
    const teamScore = side === "home" ? game.homeScore : game.awayScore;
    const opponentScore = side === "home" ? game.awayScore : game.homeScore;
    if (teamScore === null || opponentScore === null) continue;

    record.gamesScored += 1;
    record.finalGames += 1;
    record.totalPoints += teamScore;
    if (teamScore > opponentScore) record.wins += 1;
    else if (teamScore < opponentScore) record.losses += 1;
    else record.ties += 1;
  }

  return hasRecordActivity(record) ? record : undefined;
}

function normalizeTeamMatchName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(splash city)\s*(\d+u)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function hasRecordActivity(
  record:
    | Pick<TeamRecord, "gamesSeen" | "gamesScored" | "finalGames">
    | null
    | undefined,
): boolean {
  return Boolean(
    record &&
    (record.gamesSeen > 0 || record.gamesScored > 0 || record.finalGames > 0),
  );
}
function loadStoredDivisionCompareKeys(clientId: string): string[] {
  if (typeof window === "undefined") return [];
  const deviceKey = divisionCompareStorageKey(clientId);
  try {
    const stored = window.localStorage.getItem(deviceKey);
    if (stored) return parseStoredDivisionCompareKeys(stored);

    const legacyStored = window.localStorage.getItem(
      LEGACY_DIVISION_COMPARE_STORAGE_KEY,
    );
    const legacySelection = legacyStored
      ? parseStoredDivisionCompareKeys(legacyStored)
      : [];
    if (legacySelection.length > 0) {
      window.localStorage.setItem(deviceKey, JSON.stringify(legacySelection));
      window.localStorage.removeItem(LEGACY_DIVISION_COMPARE_STORAGE_KEY);
    }
    return legacySelection;
  } catch {
    return [];
  }
}

function parseStoredDivisionCompareKeys(value: string): string[] {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function stableDivisionKey(divisionName: string): string {
  return divisionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function divisionSortKey(divisionName: string): string {
  const genderRank = divisionName.toLowerCase().startsWith("girls")
    ? "2"
    : divisionName.toLowerCase().startsWith("boys")
      ? "1"
      : "3";
  return `${genderRank} ${divisionName}`;
}

function resultPlacementLabel(result: DivisionResult): string {
  if (result.placement === 1) return "Champion / 1st / Gold";
  if (result.placement === 2) return "2nd / Silver";
  return "3rd / Bronze";
}

function ordinalRank(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function teamRecordLabel(
  record: Pick<TeamRecord, "wins" | "losses" | "ties">,
): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

function recordCaption(
  record?: Pick<TeamRecord, "ties" | "gamesSeen">,
): string {
  if (record?.gamesSeen === 0) return "";
  return record && record.ties > 0 ? "W-L-T" : "W-L";
}

function recordText(record: TeamRecord | undefined, loading = false): string {
  if (record && hasRecordActivity(record)) return teamRecordLabel(record);
  return loading ? "..." : "W-L TBD";
}

function dashboardWithEffectiveGameStatuses(
  dashboard: DashboardResponse,
  now: Date,
): DashboardResponse {
  return {
    ...dashboard,
    nextGame: dashboard.nextGame
      ? withEffectiveGameStatus(dashboard.nextGame, now)
      : dashboard.nextGame,
    programs: dashboard.programs.map((program) => {
      const nextGame = program.nextGame
        ? withEffectiveGameStatus(program.nextGame, now)
        : program.nextGame;
      const latestResult = program.latestResult
        ? withEffectiveGameStatus(program.latestResult, now)
        : program.latestResult;

      return {
        ...program,
        nextGame,
        latestResult,
        teams: program.teams.map((team) => {
          const teamNextGame = team.nextGame
            ? withEffectiveGameStatus(team.nextGame, now)
            : team.nextGame;
          const teamLastResult = team.lastResult
            ? withEffectiveGameStatus(team.lastResult, now)
            : team.lastResult;
          return {
            ...team,
            nextGame: teamNextGame,
            lastResult: teamLastResult,
            liveStatus:
              teamNextGame?.status ?? teamLastResult?.status ?? team.liveStatus,
          };
        }),
      };
    }),
  };
}

function dashboardTeamIds(dashboard: DashboardResponse): string[] {
  return Array.from(
    new Set(
      dashboard.programs.flatMap((program) =>
        program.teams.map((team) => team.id),
      ),
    ),
  );
}

function dashboardFollowMigrationTeamIds(clientId: string): string[] {
  if (typeof window === "undefined") return [];
  const raw =
    window.localStorage.getItem(dashboardFollowMigrationStorageKey(clientId)) ??
    window.localStorage.getItem(DASHBOARD_FOLLOW_MIGRATION_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { teamIds?: unknown };
    if (!Array.isArray(parsed.teamIds)) return [];
    return parsed.teamIds.filter(
      (teamId): teamId is string => typeof teamId === "string",
    );
  } catch {
    return [];
  }
}

function labelStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Playing Now", "LIVE")
    .replace("Schedule Changed", "CHANGED")
    .replace("New Game Added", "NEW GAME");
}

function formatShortTime(
  iso: string,
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function formatGameDate(
  iso: string,
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

type AlertDisplay = {
  headline: string;
  meta: string | null;
  detail: string | null;
};

function alertDisplay(alert: GameChangeEvent, game: Game | null): AlertDisplay {
  const value = objectValue(alert.newValue);
  const previous = objectValue(alert.previousValue);
  const headline = alertHeadline(alert, game, value);
  const meta = alertMeta(game, value);
  const detail = alertDetail(alert.eventType, game, value, previous);

  return { headline, meta, detail };
}

function alertHeadline(
  alert: GameChangeEvent,
  game: Game | null,
  value: Record<string, unknown> | null,
): string {
  if (game) {
    if (alert.eventType === "final_score" || alert.eventType === "score_posted")
      return scoreSummary(game);
    return gameMatchupDisplayName(game);
  }

  const matchup = matchupFromValue(value);
  if (matchup) return matchup;

  if (alert.eventType === "new_team_discovered") {
    const teamName = readString(value, ["teamName", "name", "team"]);
    return teamName ? `New team found: ${teamName}` : "New watched team found";
  }

  return "Watched schedule update";
}

function alertMeta(
  game: Game | null,
  value: Record<string, unknown> | null,
): string | null {
  const parts = [
    game
      ? formatGameDate(game.startsAt)
      : formatAlertDate(
          readString(value, ["startsAt", "scheduledAt", "scheduledTime"]),
        ),
    game?.courtName ?? readString(value, ["courtName", "court"]),
    game?.venueName ?? readString(value, ["venueName", "venue"]),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" • ") : null;
}

function alertDetail(
  eventType: GameChangeEvent["eventType"],
  game: Game | null,
  value: Record<string, unknown> | null,
  previous: Record<string, unknown> | null,
): string | null {
  const currentCourt =
    game?.courtName ?? readString(value, ["courtName", "court"]);
  const previousCourt = readString(previous, ["courtName", "court"]);
  const currentVenue =
    game?.venueName ?? readString(value, ["venueName", "venue"]);
  const previousVenue = readString(previous, ["venueName", "venue"]);
  const currentTime = game
    ? formatGameDate(game.startsAt)
    : formatAlertDate(
        readString(value, ["startsAt", "scheduledAt", "scheduledTime"]),
      );
  const previousTime = formatAlertDate(
    readString(previous, ["startsAt", "scheduledAt", "scheduledTime"]),
  );

  switch (eventType) {
    case "new_game_added":
      return "New game added to your watched schedule.";
    case "game_time_changed":
    case "date_changed":
      return previousTime && currentTime
        ? `Tip changed from ${previousTime} to ${currentTime}.`
        : currentTime
          ? `Tip changed to ${currentTime}.`
          : "Tip time changed.";
    case "court_changed":
      return previousCourt && currentCourt
        ? `Court changed from ${previousCourt} to ${currentCourt}.`
        : currentCourt
          ? `Court changed to ${currentCourt}.`
          : "Court assignment changed.";
    case "venue_changed":
      return previousVenue && currentVenue
        ? `Venue changed from ${previousVenue} to ${currentVenue}.`
        : currentVenue
          ? `Venue changed to ${currentVenue}.`
          : "Venue changed.";
    case "opponent_assigned":
      return "Opponent assignment was posted.";
    case "score_posted":
      return "Score was posted by the tournament source.";
    case "final_score":
      return "Final score was posted by the tournament source.";
    case "bracket_update":
    case "team_advanced":
      return "Bracket information was updated.";
    case "starting_soon":
      return "Game is starting soon.";
    case "new_team_discovered":
      return "A team you follow was added to Court Watch AAU.";
    case "home_away_changed":
      return "Home and away assignment changed.";
    default:
      return null;
  }
}

function matchupFromValue(
  value: Record<string, unknown> | null,
): string | null {
  const home = readString(value, [
    "homeTeamNameSnapshot",
    "homeTeamName",
    "home",
  ]);
  const away = readString(value, [
    "awayTeamNameSnapshot",
    "awayTeamName",
    "away",
  ]);
  if (!home && !away) return null;
  return `${home ?? "TBD"} vs ${away ?? "TBD"}`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  value: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!value) return null;
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function formatAlertDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatGameDate(date.toISOString());
}

function scoreSummary(game: Game): string {
  if (game.homeScore === null || game.awayScore === null)
    return "No score posted";
  return `${gameTeamDisplayName(game.homeTeamNameSnapshot, game, "Home")} ${game.homeScore}, ${gameTeamDisplayName(game.awayTeamNameSnapshot, game, "Away")} ${game.awayScore}`;
}

type TeamNameDisplayInput = Pick<Team, "name" | "divisionName" | "gradeLevel">;

function teamDisplayName(team: TeamNameDisplayInput): string {
  const ageLabel = splashCityAgeLabel(
    team.name,
    team.divisionName,
    team.gradeLevel,
  );
  return ageLabel ? `Splash City ${ageLabel}` : team.name;
}

function teamMatchesSearch(team: Team, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    team.name,
    teamDisplayName(team),
    team.clubName,
    team.divisionName,
    team.gender,
    team.gradeLevel,
    team.level,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function gameMatchupDisplayName(game: Game): string {
  return `${gameTeamDisplayName(game.homeTeamNameSnapshot, game)} vs ${gameTeamDisplayName(game.awayTeamNameSnapshot, game)}`;
}

function gameTeamDisplayName(
  name: string | null,
  game: Game,
  fallback = "TBD",
): string {
  if (!name) return fallback;
  const ageLabel = splashCityAgeLabel(name, divisionNameFromGame(game));
  return ageLabel ? `Splash City ${ageLabel}` : name;
}

function splashCityAgeLabel(
  name: string,
  ...contexts: Array<string | null | undefined>
): string | null {
  if (!isSplashCityName(name)) return null;

  const sources = [name, ...contexts].filter((value): value is string =>
    Boolean(value),
  );
  return (
    sources.map(extractAgeLabel).find(Boolean) ??
    sources.map(extractGradeAgeLabel).find(Boolean) ??
    null
  );
}

function isSplashCityName(name: string): boolean {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compact = normalized.replace(/\s+/g, "");
  return (
    compact.startsWith("splashcity") || normalized.startsWith("splash city ")
  );
}

function extractAgeLabel(value: string): string | null {
  const match = value.match(/\b(\d{1,2})\s*u\b/i);
  return match ? `${Number(match[1])}U` : null;
}

function extractGradeAgeLabel(value: string): string | null {
  const grades = Array.from(
    value.toLowerCase().matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s*(?:grade)?\b/g),
  ).map((match) => Number(match[1]));
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
  return [
    "championship",
    "consolation",
    "play in",
    "gold",
    "silver",
    "bracket",
  ].some((keyword) => gameType.includes(keyword));
}

function bracketUrlFromGame(game: Game): string | null {
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  const value = (game.rawJson as { BracketUrl?: unknown }).BracketUrl;
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

function divisionBracketUrlFromGame(game: Game): string | null {
  const gameBracketUrl = bracketUrlFromGame(game);
  if (gameBracketUrl) return gameBracketUrl;
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  const links = (game.rawJson as { DivisionBracketUrls?: unknown })
    .DivisionBracketUrls;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!link || typeof link !== "object" || Array.isArray(link)) continue;
    const url = (link as { url?: unknown }).url;
    if (typeof url === "string" && url.startsWith("http")) return url;
  }
  return null;
}

function divisionNameFromGame(game: Game): string | null {
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  const raw = game.rawJson as Record<string, unknown>;
  for (const key of [
    "DivisionName",
    "divisionName",
    "Division",
    "division",
    "AgeGroup",
    "ageGroup",
  ]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
