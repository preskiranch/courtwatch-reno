"use client";

import {
  buildTeamScoringLeaders,
  courtWatchSupportedTournamentRegion,
  filterTeamScoringLeadersByDivisionIds,
  isAnyActiveTournamentWindow,
  nextGameForTeam,
  withEffectiveGameStatus,
  withEffectiveGameStatuses,
  type CourtFinderGame,
  type CourtSummary,
  type DashboardResponse,
  type DivisionResult,
  type Game,
  type GameChangeEvent,
  type ProgramSummary,
  type Team,
  type TeamScoringLeader,
  type SyncStatus,
  type TournamentEvent,
} from "@courtwatch/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  Globe2,
  Home,
  KeyRound,
  LogIn,
  Mail,
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
  UserPlus,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CourtWatchApi, CourtWatchCache, apiBaseUrl } from "../lib/api";
import {
  clearAccountSession,
  loadAccountSession,
  saveAccountSession,
  type AccountSession,
} from "../lib/account-session";
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
  replaceStoredFollowedTeams,
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

const EMPTY_RECORDS = new Map<string, TeamRecord>();

const ADMIN_EMAIL = "courtwatchaau@gmail.com";
const PUBLIC_SITE_URL = "https://www.courtwatchaau.com/";
const PUBLIC_SITE_SHARE_TEXT =
  "Court Watch AAU helps parents and teams follow AAU tournament schedules, courts, records, brackets, alerts, and final results.";

const tabs: Array<{
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "teams", label: "Teams", icon: Users },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Dev Tools", icon: Settings },
];

const LIVE_DATA_REFETCH_MS = 60_000;
const LIVE_SYNC_STATUS_REFETCH_MS = 1_000;
const ALL_TOURNAMENT_REGIONS = "all";
const NORTHERN_CALIFORNIA_REGION = "norcal";
const SOUTHERN_CALIFORNIA_REGION = "socal";
const NEVADA_REGION = "state:NV";

type TournamentRegionFilter = string;
const PASSIVE_DATA_REFETCH_MS = 12 * 60_000;
const DEFER_HEAVY_DASHBOARD_DATA_MS = 1_500;
const DEFAULT_TRACKED_EXPOSURE_EVENT_ID = 255539;

function invalidateLiveDataQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["games"] }),
    queryClient.invalidateQueries({ queryKey: ["alerts"] }),
    queryClient.invalidateQueries({ queryKey: ["events"] }),
    queryClient.invalidateQueries({ queryKey: ["results"] }),
    queryClient.invalidateQueries({ queryKey: ["teams"] }),
    queryClient.invalidateQueries({ queryKey: ["points-leaders"] }),
  ]);
}

export function CourtWatchApp() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [toast, setToast] = useState<string | null>(null);
  const [presenceClientId, setPresenceClientId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [accountSession, setAccountSession] = useState<AccountSession | null>(
    null,
  );
  const [browserOnline, setBrowserOnline] = useState(true);
  const [syncStreamConnected, setSyncStreamConnected] = useState(false);
  const queryClient = useQueryClient();
  const accountScope = accountSession
    ? `account:${accountSession.user.id}`
    : presenceClientId;
  const isAdmin = isAdminAccount(accountSession);
  const visibleTabs = useMemo(
    () => (isAdmin ? tabs : tabs.filter((tab) => tab.id !== "settings")),
    [isAdmin],
  );
  const clientReady = Boolean(presenceClientId);
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: CourtWatchApi.events,
    initialData: CourtWatchCache.events,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const fetchedEvents = eventsQuery.data ?? [];
  const selectedFetchedEvent = selectedEventId
    ? fetchedEvents.find((event) => event.exposureEventId === selectedEventId)
    : null;
  const eventsLoaded = Boolean(eventsQuery.data);
  const activeEventId =
    selectedEventId && (!eventsLoaded || selectedFetchedEvent)
      ? selectedEventId
      : eventsLoaded
        ? (fetchedEvents[0]?.exposureEventId ?? null)
        : null;
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
  const anyFetchedEventIsActive = isAnyActiveTournamentWindow(fetchedEvents);
  const syncStatusFallbackRefetchInterval =
    anyFetchedEventIsActive || dataRefetchInterval === LIVE_DATA_REFETCH_MS
      ? LIVE_SYNC_STATUS_REFETCH_MS
      : PASSIVE_DATA_REFETCH_MS;
  const syncStatusRefetchInterval = syncStreamConnected
    ? PASSIVE_DATA_REFETCH_MS
    : syncStatusFallbackRefetchInterval;
  const lastTodayKeyRef = useRef(todayKey);
  const lastSyncFingerprintRef = useRef<string | null>(null);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", accountScope, activeEventId],
    queryFn: () => CourtWatchApi.dashboard(activeEventId),
    enabled: clientReady && Boolean(activeEventId),
    initialData: () =>
      activeEventId ? CourtWatchCache.dashboard(activeEventId) : undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const auxiliaryEventDataEnabled =
    clientReady &&
    Boolean(activeEventId) &&
    (activeTab === "schedule" ||
      activeTab === "alerts" ||
      Boolean(dashboardQuery.data));
  const gamesQuery = useQuery({
    queryKey: ["games", accountScope, activeEventId],
    queryFn: () => CourtWatchApi.games("", activeEventId),
    enabled: auxiliaryEventDataEnabled,
    initialData: () =>
      activeEventId ? CourtWatchCache.games(activeEventId) : undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const alertsQuery = useQuery({
    queryKey: ["alerts", accountScope, activeEventId],
    queryFn: () => CourtWatchApi.alerts(activeEventId),
    enabled: auxiliaryEventDataEnabled,
    initialData: () =>
      activeEventId ? CourtWatchCache.alerts(activeEventId) : undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: dataRefetchInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const syncStatusQuery = useQuery({
    queryKey: ["sync-status", "all"],
    queryFn: () => CourtWatchApi.syncStatus(null, "all"),
    enabled: Boolean(activeEventId),
    staleTime: 0,
    refetchInterval: syncStatusRefetchInterval,
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
  const accountStatsQuery = useQuery({
    queryKey: ["account-stats"],
    queryFn: CourtWatchApi.accountStats,
    initialData: CourtWatchCache.accountStats,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    setPresenceClientId(stableClientId());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateOnlineState = () => setBrowserOnline(window.navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    const savedSession = loadAccountSession();
    if (!savedSession) {
      return;
    }

    let cancelled = false;
    setAccountSession(savedSession);
    CourtWatchApi.accountMe()
      .then((response) => {
        if (cancelled) return;
        setAccountSession(
          saveAccountSession({
            token: savedSession.token,
            user: response.user,
            totalRegisteredUsers: response.totalRegisteredUsers,
          }),
        );
      })
      .catch(() => {
        if (cancelled) return;
        clearAccountSession();
        setAccountSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab === "settings" && !isAdmin) setActiveTab("dashboard");
  }, [activeTab, isAdmin]);

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
      const next = eventsQuery.data[0]?.exposureEventId ?? null;
      if (typeof window !== "undefined") {
        if (next) {
          window.localStorage.setItem(SELECTED_EVENT_STORAGE_KEY, String(next));
        } else {
          window.localStorage.removeItem(SELECTED_EVENT_STORAGE_KEY);
        }
      }
      return next;
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
    const fingerprint = syncStatusQuery.data?.fingerprint;
    if (!fingerprint) return;
    if (!lastSyncFingerprintRef.current) {
      lastSyncFingerprintRef.current = fingerprint;
      return;
    }
    if (lastSyncFingerprintRef.current === fingerprint) return;
    lastSyncFingerprintRef.current = fingerprint;
    void invalidateLiveDataQueries(queryClient);
  }, [queryClient, syncStatusQuery.data?.fingerprint]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !activeEventId ||
      !("EventSource" in window)
    ) {
      setSyncStreamConnected(false);
      return;
    }

    let closed = false;
    const streamUrl = new URL("/api/realtime/sync-status", apiBaseUrl());
    streamUrl.searchParams.set("scope", "all");
    const source = new EventSource(streamUrl.toString());

    const handleStatus = (event: MessageEvent<string>) => {
      try {
        const status = JSON.parse(event.data) as SyncStatus;
        const fingerprint = status.fingerprint;
        if (!fingerprint) return;
        if (!lastSyncFingerprintRef.current) {
          lastSyncFingerprintRef.current = fingerprint;
          return;
        }
        if (lastSyncFingerprintRef.current === fingerprint) return;
        lastSyncFingerprintRef.current = fingerprint;
        void invalidateLiveDataQueries(queryClient);
      } catch {
        // Ignore malformed stream payloads and keep the polling fallback alive.
      }
    };

    source.addEventListener("sync-status", handleStatus as EventListener);
    source.onopen = () => {
      if (!closed) setSyncStreamConnected(true);
    };
    source.onerror = () => {
      if (!closed) setSyncStreamConnected(false);
    };

    return () => {
      closed = true;
      setSyncStreamConnected(false);
      source.removeEventListener("sync-status", handleStatus as EventListener);
      source.close();
    };
  }, [activeEventId, queryClient]);

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

  useEffect(() => {
    if (
      !accountSession ||
      !presenceClientId ||
      !accountScope ||
      !activeEventId ||
      typeof window === "undefined"
    )
      return;

    const deviceTeams = loadStoredFollowedTeams(
      presenceClientId,
      activeEventId,
    );
    if (deviceTeams.length === 0) return;

    const teamKey = deviceTeams
      .map((team) => team.id)
      .sort()
      .join(",");
    const syncKey = `courtwatch-aau:account-sync:${accountSession.user.id}:${encodeURIComponent(
      presenceClientId,
    )}:${activeEventId}:${encodeURIComponent(teamKey)}`;
    if (window.localStorage.getItem(syncKey) === "complete") return;

    let cancelled = false;
    window.localStorage.setItem(syncKey, "running");
    CourtWatchApi.syncFollowedTeams(
      deviceTeams.map((team) => team.id),
      activeEventId,
    )
      .then(() => {
        if (cancelled) return;
        mergeStoredFollowedTeams(accountScope, activeEventId, deviceTeams);
        window.localStorage.setItem(syncKey, "complete");
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["games"] }),
          queryClient.invalidateQueries({ queryKey: ["alerts"] }),
          queryClient.invalidateQueries({ queryKey: ["events"] }),
          queryClient.invalidateQueries({ queryKey: ["results"] }),
          queryClient.invalidateQueries({ queryKey: ["teams"] }),
          queryClient.invalidateQueries({ queryKey: ["points-leaders"] }),
        ]);
        setToast("Saved teams synced to your account");
        window.setTimeout(() => setToast(null), 2200);
      })
      .catch(() => {
        window.localStorage.removeItem(syncKey);
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountScope,
    accountSession,
    activeEventId,
    presenceClientId,
    queryClient,
  ]);

  useEffect(() => {
    if (
      !accountSession ||
      !accountScope ||
      !activeEventId ||
      !dashboardQuery.data
    )
      return;
    replaceStoredFollowedTeams(
      accountScope,
      activeEventId,
      dashboardTeams(dashboardQuery.data),
    );
  }, [accountScope, accountSession, activeEventId, dashboardQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
      queryClient.invalidateQueries({ queryKey: ["alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
      queryClient.invalidateQueries({ queryKey: ["results"] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
      queryClient.invalidateQueries({ queryKey: ["points-leaders"] }),
      queryClient.invalidateQueries({ queryKey: ["account-stats"] }),
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
    (!dashboard && eventsQuery.isLoading) ||
    (!hasNoEvents && (!activeEventId || dashboardQuery.isLoading));
  const allPrimarySourceQueriesFailed =
    dashboardQuery.isError &&
    gamesQuery.isError &&
    alertsQuery.isError &&
    eventsQuery.isError &&
    !dashboard &&
    displayEvents.length === 0;
  const offline = !browserOnline || allPrimarySourceQueriesFailed;

  return (
    <>
      <SideBezel />
      <ShareQrRail />
      <main className="courtwatch-content-shell relative z-10 mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pt-4 text-white sm:max-w-3xl md:max-w-5xl">
        <AppHeader
          dashboard={dashboard}
          events={displayEvents}
          eventsLoading={eventsQuery.isLoading}
          selectedEventId={activeEventId}
          offline={offline}
          activeUsers={presenceQuery.data?.activeUsers ?? null}
          registeredUsers={
            accountStatsQuery.data?.registeredUsers ??
            accountSession?.totalRegisteredUsers ??
            null
          }
          unregisteredFollowerDevices={
            accountStatsQuery.data?.unregisteredFollowerDevices ?? null
          }
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
              clientId={accountScope ?? presenceClientId}
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
              clientId={accountScope ?? presenceClientId}
              accountSession={accountSession}
              onAccountSessionChange={setAccountSession}
              onRefresh={refresh}
              timezone={dashboard.event.timezone}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "alerts" ? (
            <AlertsScreen
              alerts={alertsQuery.data ?? dashboard.alerts}
              games={games}
            />
          ) : null}
          {!isLoading && dashboard && activeTab === "settings" && isAdmin ? (
            <SettingsScreen
              dashboard={dashboard}
              onRefresh={refresh}
              eventId={activeEventId}
            />
          ) : null}
        </section>

        <AppFooterCredit />
        <BottomTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabs={visibleTabs}
        />
      </main>
    </>
  );
}

function SideBezel() {
  return (
    <div className="courtwatch-side-bezels" aria-hidden="true">
      <div className="courtwatch-side-bezel courtwatch-side-bezel-left" />
      <div className="courtwatch-side-bezel courtwatch-side-bezel-right" />
    </div>
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
  const [showShareFallback, setShowShareFallback] = useState(false);
  const [showQrOpenOption, setShowQrOpenOption] = useState(false);
  const qrLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrSize =
    layout === "rail" ? "h-24 w-24 2xl:h-32 2xl:w-32" : "h-20 w-20";

  async function shareSite() {
    const shareData = {
      title: "Court Watch AAU",
      text: PUBLIC_SITE_SHARE_TEXT,
      url: PUBLIC_SITE_URL,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }

    setShowShareFallback((current) => !current);
  }

  async function copySiteLink() {
    await navigator.clipboard?.writeText(PUBLIC_SITE_URL);
    setShowShareFallback(false);
  }

  function startQrLongPress() {
    clearQrLongPress();
    qrLongPressTimer.current = setTimeout(() => {
      setShowQrOpenOption(true);
      setShowShareFallback(false);
    }, 650);
  }

  function clearQrLongPress() {
    if (!qrLongPressTimer.current) return;
    clearTimeout(qrLongPressTimer.current);
    qrLongPressTimer.current = null;
  }

  return (
    <section
      className={clsx(
        "rounded-lg border border-white/12 bg-[#07111f]/92 p-2 text-white shadow-2xl backdrop-blur",
        layout === "rail"
          ? "text-center"
          : "flex max-w-[320px] items-center gap-3",
      )}
      aria-label="Share Court Watch AAU"
    >
      <div className="relative shrink-0">
        <button
          type="button"
          onPointerDown={startQrLongPress}
          onPointerUp={clearQrLongPress}
          onPointerLeave={clearQrLongPress}
          onPointerCancel={clearQrLongPress}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Hold QR code for site link"
          className="block rounded-md transition active:scale-95"
        >
          <img
            src="/share/courtwatch-reno-qr.jpg"
            alt="QR code for Court Watch AAU"
            draggable={false}
            className={clsx(
              "select-none rounded-md border border-white bg-white object-contain",
              qrSize,
            )}
          />
        </button>
        {showQrOpenOption ? (
          <div className="absolute left-0 z-30 mt-2 rounded-lg border border-white/12 bg-slate-950 p-2 shadow-2xl">
            <a
              href={PUBLIC_SITE_URL}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-9 min-w-28 items-center rounded-md px-3 text-xs font-black text-white hover:bg-white/10"
            >
              Open site
            </a>
          </div>
        ) : null}
      </div>
      <div className={clsx("relative", layout === "rail" ? "mt-2" : "min-w-0")}>
        <button
          type="button"
          onClick={shareSite}
          className={clsx(
            "flex min-h-8 items-center gap-1 text-orange-300 transition active:scale-95",
            layout === "rail" ? "mx-auto justify-center" : "",
          )}
          aria-label="Share Court Watch AAU"
        >
          <Share2 className="h-4 w-4" />
          <span className="text-[11px] font-black uppercase tracking-[0.12em]">
            Share
          </span>
        </button>
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
        {showShareFallback ? (
          <div
            className={clsx(
              "absolute z-30 mt-2 rounded-lg border border-white/12 bg-slate-950 p-2 shadow-2xl",
              layout === "rail" ? "left-1/2 w-36 -translate-x-1/2" : "left-0",
            )}
          >
            <a
              href={`sms:?&body=${encodeURIComponent(`${PUBLIC_SITE_SHARE_TEXT} ${PUBLIC_SITE_URL}`)}`}
              className="flex min-h-9 items-center gap-2 rounded-md px-2 text-xs font-black text-white hover:bg-white/10"
            >
              <Smartphone className="h-4 w-4 text-orange-300" />
              Text
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent("Court Watch AAU")}&body=${encodeURIComponent(`${PUBLIC_SITE_SHARE_TEXT}\n\n${PUBLIC_SITE_URL}`)}`}
              className="flex min-h-9 items-center gap-2 rounded-md px-2 text-xs font-black text-white hover:bg-white/10"
            >
              <Mail className="h-4 w-4 text-orange-300" />
              Email
            </a>
            <button
              type="button"
              onClick={copySiteLink}
              className="flex min-h-9 w-full items-center rounded-md px-2 text-left text-xs font-black text-white hover:bg-white/10"
            >
              Copy link
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AppHeader({
  dashboard,
  events,
  eventsLoading,
  selectedEventId,
  offline,
  activeUsers,
  registeredUsers,
  unregisteredFollowerDevices,
  onRefresh,
  refreshing,
  onSelectEvent,
}: {
  dashboard?: DashboardResponse;
  events: TournamentEvent[];
  eventsLoading: boolean;
  selectedEventId: number | null;
  offline: boolean;
  activeUsers: number | null;
  registeredUsers: number | null;
  unregisteredFollowerDevices: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  onSelectEvent: (eventId: number) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [regionFilter, setRegionFilter] = useState<TournamentRegionFilter>(
    ALL_TOURNAMENT_REGIONS,
  );
  const selectedEvent =
    events.find((event) => event.exposureEventId === selectedEventId) ??
    dashboard?.event;
  useEffect(() => {
    if (!pickerOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);
  const statusMessage = offline
    ? "Offline cache"
    : (dashboard?.sourceStatus.message ??
      (selectedEvent
        ? "Schedule data is current from the latest successful sync."
        : "Loading source"));
  const lastUpdated =
    dashboard?.lastUpdated ??
    selectedEvent?.lastSyncedAt ??
    selectedEvent?.lastCheckedAt;
  const displayTimezone =
    dashboard?.event.timezone ??
    selectedEvent?.timezone ??
    DEFAULT_TOURNAMENT_TIME_ZONE;
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-white/10 bg-[#07111f]/92 px-4 pb-3 pt-3 backdrop-blur">
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
      <div className="mt-3">
        <div className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
          Tournament
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-white/12 bg-slate-950 px-3 py-2 text-left text-sm font-black text-white transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 active:scale-[0.995]"
          disabled={events.length === 0}
        >
          <span className="line-clamp-2">
            {selectedEvent
              ? tournamentOptionLabel(selectedEvent)
              : eventsLoading
                ? "Loading tournaments..."
                : events.length === 0
                  ? "No public-source tournaments found in the next six months"
                  : "Choose tournament"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-300" />
        </button>
      </div>
      {pickerOpen ? (
        <TournamentPickerSheet
          events={events}
          selectedEventId={selectedEventId}
          regionFilter={regionFilter}
          onRegionFilterChange={setRegionFilter}
          onClose={() => setPickerOpen(false)}
          onSelectEvent={(eventId) => {
            onSelectEvent(eventId);
            setPickerOpen(false);
          }}
        />
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-300">
        <span className="min-w-0 flex-1 items-center gap-1.5 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            {offline ? (
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-orange-300" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            )}
            <span className="line-clamp-2">{statusMessage}</span>
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-white/8 px-2 py-1 text-[11px] font-black text-white min-[390px]:inline-flex">
          <Users className="h-3.5 w-3.5 text-orange-300" />
          <span>{registeredUsers ?? "-"} registered</span>
          <span className="text-slate-500">·</span>
          <span>{unregisteredFollowerDevices ?? "-"} followers</span>
        </span>
        <span className="shrink-0 text-right">
          {lastUpdated
            ? `Updated ${formatShortTime(lastUpdated, displayTimezone)}`
            : "Sync pending"}
        </span>
      </div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2 py-1 text-[11px] font-black text-white min-[390px]:hidden">
        <Users className="h-3.5 w-3.5 text-orange-300" />
        <span>{registeredUsers ?? "-"} registered</span>
        <span className="text-slate-500">·</span>
        <span>{unregisteredFollowerDevices ?? "-"} team followers</span>
      </div>
    </header>
  );
}

function AppFooterCredit() {
  return (
    <footer className="mt-8 pb-2 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-400">
      Designed by Preski Ranch LLC
    </footer>
  );
}

function TournamentPickerSheet({
  events,
  selectedEventId,
  regionFilter,
  onRegionFilterChange,
  onSelectEvent,
  onClose,
}: {
  events: TournamentEvent[];
  selectedEventId: number | null;
  regionFilter: TournamentRegionFilter;
  onRegionFilterChange: (region: TournamentRegionFilter) => void;
  onSelectEvent: (eventId: number) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const visibleEvents = useMemo(
    () => events.filter(isSupportedTournamentEventForUi),
    [events],
  );
  const regionOptions = useMemo(
    () => tournamentRegionOptions(visibleEvents),
    [visibleEvents],
  );
  const sections = useMemo(
    () => tournamentPickerSections(visibleEvents, regionFilter),
    [visibleEvents, regionFilter],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483647] bg-slate-950/96 text-white backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="Choose tournament"
    >
      <div className="flex h-dvh min-h-0 flex-col">
        <div className="border-b border-white/10 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-300">
                Tournament
              </p>
              <h2 className="mt-1 text-xl font-black tracking-normal">
                Choose by region
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/12 bg-white/8 text-white transition active:scale-95"
              aria-label="Close tournament selector"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="border-b border-white/10 px-4 py-3">
          <div className="no-scrollbar mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto">
            {regionOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onRegionFilterChange(option.id)}
                className={clsx(
                  "shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-black transition active:scale-95",
                  regionFilter === option.id
                    ? "border-orange-400 bg-orange-500 text-white"
                    : "border-white/10 bg-white/8 text-slate-200",
                )}
              >
                <span className="block whitespace-nowrap">{option.label}</span>
                <span
                  className={clsx(
                    "mt-0.5 block text-[10px] uppercase tracking-normal",
                    regionFilter === option.id
                      ? "text-orange-50"
                      : "text-slate-400",
                  )}
                >
                  {option.count} events
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 safe-bottom">
          <div className="mx-auto w-full max-w-6xl space-y-5">
            {sections.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/8 p-4 text-sm font-semibold text-slate-300">
                No tournaments found for this region.
              </div>
            ) : null}
            {sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3
                    id={section.id}
                    className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-300"
                  >
                    {section.label}
                  </h3>
                  <span className="rounded-md bg-white/8 px-2 py-1 text-[11px] font-black text-slate-200">
                    {section.events.length}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {section.events.map((event) => (
                    <TournamentPickerEvent
                      key={`${section.id}-${event.exposureEventId}`}
                      event={event}
                      selected={event.exposureEventId === selectedEventId}
                      onSelect={() => onSelectEvent(event.exposureEventId)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TournamentPickerEvent({
  event,
  selected,
  onSelect,
}: {
  event: TournamentEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = effectiveTournamentStatus(event);
  const date =
    event.startDate === event.endDate
      ? compactTournamentDate(event.startDate, event.timezone)
      : `${compactTournamentDate(event.startDate, event.timezone)}-${compactTournamentDate(event.endDate, event.timezone)}`;
  const place =
    event.city && event.state
      ? `${event.city}, ${event.state}`
      : event.location;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex min-h-24 w-full items-start gap-3 rounded-lg border p-3 text-left transition active:scale-[0.99]",
        selected
          ? "border-orange-400 bg-orange-500/16 ring-2 ring-orange-400/25"
          : "border-white/10 bg-white/8 hover:bg-white/12",
      )}
    >
      <span
        className={clsx(
          "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md",
          selected ? "bg-orange-500 text-white" : "bg-slate-900 text-slate-300",
        )}
      >
        {selected ? (
          <Check className="h-4 w-4" />
        ) : (
          <CalendarDays className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-black leading-5 text-white">
          {event.name}
        </span>
        <span className="mt-1 block text-xs font-semibold text-slate-300">
          {place} — {date}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-md bg-slate-950 px-2 py-1 text-[10px] font-black uppercase text-slate-200">
            {event.registeredTeamCount > 0
              ? `${event.registeredTeamCount} teams`
              : "Teams not posted"}
          </span>
          <span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-200">
            {tournamentRegionLabel(event)}
          </span>
          <span
            className={clsx(
              "rounded-md px-2 py-1 text-[10px] font-black uppercase",
              status === "active" && "bg-emerald-400/18 text-emerald-200",
              status === "upcoming" && "bg-sky-400/18 text-sky-200",
              status === "completed" && "bg-slate-200/12 text-slate-200",
              (status === "cancelled" || status === "unavailable") &&
                "bg-red-400/18 text-red-200",
            )}
          >
            {status}
          </span>
        </span>
      </span>
    </button>
  );
}

function tournamentPickerSections(
  events: TournamentEvent[],
  regionFilter: TournamentRegionFilter,
): Array<{ id: string; label: string; events: TournamentEvent[] }> {
  const filteredEvents = events.filter((event) =>
    tournamentMatchesRegion(event, regionFilter),
  );
  const trackedEvents = filteredEvents.filter(
    (event) =>
      event.dropdownGroup === "tracked" &&
      effectiveTournamentStatus(event) !== "completed",
  );
  const publicSourceEvents = filteredEvents.filter(
    (event) => event.dropdownGroup !== "tracked",
  );
  const activePublicSourceEvents = publicSourceEvents.filter(
    (event) => effectiveTournamentStatus(event) === "active",
  );
  const upcomingPublicSourceEvents = publicSourceEvents.filter(
    (event) => effectiveTournamentStatus(event) === "upcoming",
  );
  const completedEvents = filteredEvents.filter(
    (event) => effectiveTournamentStatus(event) === "completed",
  );
  return [
    {
      id: "tracked-events",
      label: "My tracked events",
      events: trackedEvents,
    },
    {
      id: "active-events",
      label: "Active tournaments",
      events: activePublicSourceEvents,
    },
    {
      id: "upcoming-events",
      label: "Upcoming tournaments",
      events: upcomingPublicSourceEvents,
    },
    {
      id: "finished-events",
      label: "Finished tournaments",
      events: completedEvents,
    },
  ].filter((section) => section.events.length > 0);
}

function tournamentRegionOptions(events: TournamentEvent[]): Array<{
  id: TournamentRegionFilter;
  label: string;
  count: number;
}> {
  const counts = new Map<TournamentRegionFilter, number>();
  for (const event of events) {
    const id = tournamentRegionKey(event);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const options = [
    {
      id: ALL_TOURNAMENT_REGIONS,
      label: "All",
      count: events.length,
    },
    {
      id: NORTHERN_CALIFORNIA_REGION,
      label: "Northern California",
      count: counts.get(NORTHERN_CALIFORNIA_REGION) ?? 0,
    },
    {
      id: SOUTHERN_CALIFORNIA_REGION,
      label: "Southern California",
      count: counts.get(SOUTHERN_CALIFORNIA_REGION) ?? 0,
    },
    {
      id: NEVADA_REGION,
      label: "Nevada",
      count: counts.get(NEVADA_REGION) ?? 0,
    },
  ];
  return options.filter(
    (option) => option.id === ALL_TOURNAMENT_REGIONS || option.count > 0,
  );
}

function tournamentMatchesRegion(
  event: TournamentEvent,
  regionFilter: TournamentRegionFilter,
): boolean {
  if (regionFilter === ALL_TOURNAMENT_REGIONS) {
    return isSupportedTournamentEventForUi(event);
  }
  return tournamentRegionKey(event) === regionFilter;
}

function tournamentRegionLabel(event: TournamentEvent): string {
  return tournamentRegionName(tournamentRegionKey(event));
}

function tournamentRegionName(region: TournamentRegionFilter): string {
  if (region === ALL_TOURNAMENT_REGIONS) return "All";
  if (region === NORTHERN_CALIFORNIA_REGION) return "Northern CA";
  if (region === SOUTHERN_CALIFORNIA_REGION) return "Southern CA";
  if (region === NEVADA_REGION) return "Nevada";
  if (region.startsWith("state:")) {
    const state = region.slice("state:".length);
    return STATE_LABELS[state] ?? state;
  }
  return "Other";
}

function tournamentRegionKey(event: TournamentEvent): TournamentRegionFilter {
  const region = courtWatchSupportedTournamentRegion(event);
  if (region === "Northern California") return NORTHERN_CALIFORNIA_REGION;
  if (region === "Southern California") return SOUTHERN_CALIFORNIA_REGION;
  if (region === "Nevada") return NEVADA_REGION;
  return "state:OTHER";
}

function isSupportedTournamentEventForUi(event: TournamentEvent): boolean {
  return courtWatchSupportedTournamentRegion(event) !== null;
}

const STATE_LABELS: Record<string, string> = {
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  FL: "Florida",
  NV: "Nevada",
  OR: "Oregon",
  TX: "Texas",
  WA: "Washington",
  OTHER: "Other",
};

function effectiveTournamentStatus(
  event: TournamentEvent,
): TournamentEvent["status"] {
  if (event.status === "cancelled" || event.status === "unavailable") {
    return event.status;
  }
  const todayKey = dateKeyInTimeZone(new Date(), event.timezone);
  if (event.endDate < todayKey) return "completed";
  if (event.startDate <= todayKey && event.endDate >= todayKey) {
    return "active";
  }
  return "upcoming";
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
  const [loadHeavyDashboardData, setLoadHeavyDashboardData] = useState(false);
  useEffect(() => {
    setLoadHeavyDashboardData(false);
    if (!eventId || typeof window === "undefined") return;
    const timeout = window.setTimeout(
      () => setLoadHeavyDashboardData(true),
      DEFER_HEAVY_DASHBOARD_DATA_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [eventId]);

  const allGamesQuery = useQuery({
    queryKey: ["games", "all", eventId],
    queryFn: () => CourtWatchApi.allGames(eventId),
    enabled: loadHeavyDashboardData && Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const teamsQuery = useQuery({
    queryKey: ["teams", "all", clientId, eventId],
    queryFn: () => CourtWatchApi.teams("", eventId),
    enabled: loadHeavyDashboardData && Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const pointsLeadersQuery = useQuery({
    queryKey: ["points-leaders", eventId],
    queryFn: () => CourtWatchApi.pointsLeaders(eventId),
    enabled: loadHeavyDashboardData && Boolean(eventId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const dashboardPointLeaders = dashboard.pointsLeaders ?? [];
  const fallbackPointLeaders = useMemo(() => {
    if (!loadHeavyDashboardData || dashboardPointLeaders.length > 0) return [];
    const teams = teamsQuery.data ?? [];
    if (teams.length === 0) return [];
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    return buildTeamScoringLeaders(allGamesQuery.data ?? games, teams, {
      includeUnscoredTeams: true,
    }).map((leader) => {
      const team = leader.teamId ? teamsById.get(leader.teamId) : null;
      return team ? { ...leader, teamName: teamDisplayName(team) } : leader;
    });
  }, [
    allGamesQuery.data,
    dashboardPointLeaders.length,
    games,
    loadHeavyDashboardData,
    teamsQuery.data,
  ]);
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
    { authoritative: isAccountClientId(clientId) },
  );
  const suppressedFollowedIds = useMemo(
    () => loadSuppressedFollowedTeamIds(clientId, eventId),
    [clientId, eventId, storedFollowedTeams],
  );
  const dashboardWithoutSuppressedFollows = useMemo(
    () =>
      suppressedFollowedIds.size === 0
        ? dashboard
        : {
            ...dashboard,
            programs: dashboard.programs.map((program) => ({
              ...program,
              teams: program.teams.filter(
                (team) => !suppressedFollowedIds.has(team.id),
              ),
            })),
          },
    [dashboard, suppressedFollowedIds],
  );
  const trustedRegisteredTeams = useMemo(
    () =>
      teamsWithTrustedFollowState(
        loadHeavyDashboardData
          ? (teamsQuery.data ?? [])
          : dashboardFollowedTeams,
        storedFollowedTeams,
      ),
    [
      dashboardFollowedTeams,
      loadHeavyDashboardData,
      storedFollowedTeams,
      teamsQuery.data,
    ],
  );
  const teamsForFollowState = useMemo(
    () => mergeTeamLists(trustedRegisteredTeams, storedFollowedTeams),
    [storedFollowedTeams, trustedRegisteredTeams],
  );
  const recordGames = allGamesQuery.data ?? games;
  const teamRecords = useMemo(
    () => buildTeamRecordMap(recordGames, teamsForFollowState),
    [recordGames, teamsForFollowState],
  );
  const recordsLoading =
    loadHeavyDashboardData && (allGamesQuery.isLoading || teamsQuery.isLoading);
  const effectiveDashboard = useMemo(
    () =>
      dashboardWithRegisteredFollows(
        dashboardWithoutSuppressedFollows,
        teamsForFollowState,
        recordGames,
        teamRecords,
      ),
    [
      dashboardWithoutSuppressedFollows,
      recordGames,
      teamRecords,
      teamsForFollowState,
    ],
  );
  const finalResultFollowedTeams =
    storedFollowedTeams.length > 0
      ? storedFollowedTeams
      : effectiveDashboard.programs.flatMap((program) => program.teams);

  return (
    <div className="space-y-4">
      <NextGameBanner
        game={effectiveDashboard.nextGame}
        records={teamRecords}
        timezone={dashboard.event.timezone}
        hasFollowedTeams={finalResultFollowedTeams.length > 0}
        tournamentFinished={isTournamentFinished(dashboard.event)}
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
            event={dashboard.event}
            records={teamRecords}
            recordsLoading={recordsLoading}
            timezone={dashboard.event.timezone}
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
        event={dashboard.event}
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
  timezone,
  hasFollowedTeams,
  tournamentFinished,
}: {
  game: Game | null;
  records: Map<string, TeamRecord>;
  timezone?: string | null;
  hasFollowedTeams: boolean;
  tournamentFinished: boolean;
}) {
  if (!game) {
    const title = tournamentFinished
      ? "Tournament finished"
      : hasFollowedTeams
        ? "No next game posted"
        : "Choose teams to follow";
    const subtitle = tournamentFinished
      ? "Final results are posted below when available."
      : hasFollowedTeams
        ? "Court Watch AAU is watching for bracket updates."
        : "Search registered teams from the Teams tab.";
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
            <h2 className="text-xl font-black text-slate-950">{title}</h2>
            <p className="text-sm font-medium text-slate-600">{subtitle}</p>
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
          <p className="mt-0.5 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            {formatGameDateOnly(
              game.startsAt,
              game.timezone ?? timezone ?? DEFAULT_TOURNAMENT_TIME_ZONE,
            )}
          </p>
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
  event,
  records,
  recordsLoading,
  timezone,
}: {
  program: ProgramSummary;
  event: TournamentEvent;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
  timezone?: string | null;
}) {
  const found = program.teams.length;
  const tournamentFinished = isTournamentFinished(event);
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
        <Metric
          label="Next"
          value={
            program.nextGame
              ? formatNextGameSummary(program.nextGame, timezone)
              : tournamentFinished
                ? "Finished"
                : "TBD"
          }
        />
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
                ? formatTeamNextGameSummary(team, team.nextGame, timezone)
                : tournamentFinished
                  ? "Tournament finished"
                  : "Next game awaiting bracket"}
            </p>
            {team.nextGame ? (
              <TeamNextGameLocationLine game={team.nextGame} />
            ) : null}
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
  event,
  eventId,
  followedTeams,
}: {
  clientId: string;
  event: TournamentEvent;
  eventId: number | null;
  followedTeams: Team[];
}) {
  const [scope, setScope] = useState<"watched" | "all">("watched");
  useEffect(() => {
    if (followedTeams.length === 0) {
      setScope("all");
    }
  }, [followedTeams.length]);
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
            event={event}
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

type FinalResultShareRow = {
  label: string;
  teamName: string;
  recordText: string;
  placement: number;
  note?: string;
};

type GeneratedResultShareCard = {
  blob: Blob;
  filename: string;
  url: string;
};

function DivisionResultCard({
  event,
  group,
  records,
  games,
  teams,
  recordsLoading,
}: {
  event: TournamentEvent;
  group: FollowedFinalResultGroup;
  records: Map<string, TeamRecord>;
  games: Game[];
  teams: Team[];
  recordsLoading: boolean;
}) {
  const [shareCard, setShareCard] = useState<GeneratedResultShareCard | null>(
    null,
  );
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const unplacedFollowedTeams = group.followedTeamsWithoutPlacement ?? [];
  const resultStatusLabel =
    !group.hasPostedPlacements && group.rows.length === 0
      ? "Pending"
      : group.isOfficial
        ? "Official"
        : "Bracket final";

  useEffect(() => {
    return () => {
      if (shareCard?.url) URL.revokeObjectURL(shareCard.url);
    };
  }, [shareCard?.url]);

  const createShareCard = async () => {
    setShareBusy(true);
    setShareError(null);
    try {
      const blob = await renderFinalResultShareImage({
        event,
        group,
        rows: finalResultShareRows(group, records, games, teams),
      });
      const url = URL.createObjectURL(blob);
      setShareCard({
        blob,
        filename: finalResultShareFilename(event, group),
        url,
      });
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : "Unable to create the result image.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const shareGeneratedCard = async () => {
    if (!shareCard) return;
    const file = new File([shareCard.blob], shareCard.filename, {
      type: "image/png",
    });
    const shareData: ShareData = {
      files: [file],
      title: `${group.divisionName} final results`,
      text: `Court Watch AAU final results for ${group.divisionName}.`,
    };
    try {
      if (
        typeof navigator.share === "function" &&
        (typeof navigator.canShare !== "function" ||
          navigator.canShare(shareData))
      ) {
        await navigator.share(shareData);
        return;
      }
      setShareError("Use Save image, then post or send it from your device.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareError(
        error instanceof Error ? error.message : "Unable to share this image.",
      );
    }
  };

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

      {shareCard ? (
        <div className="mt-3 rounded-lg border border-orange-100 bg-orange-50 p-3">
          <div className="flex gap-3">
            <img
              src={shareCard.url}
              alt={`${group.divisionName} share image preview`}
              className="h-28 w-20 shrink-0 rounded-md border border-white object-cover shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-950">
                Custom graphic ready
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                Save it to your device or use your phone share sheet.
              </p>
              <div className="mt-3 grid gap-2 min-[420px]:grid-cols-2">
                <button
                  type="button"
                  onClick={shareGeneratedCard}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-black text-white active:scale-[0.98]"
                >
                  <Share2 className="h-4 w-4" />
                  Share graphic
                </button>
                <a
                  href={shareCard.url}
                  download={shareCard.filename}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-black text-orange-700 ring-1 ring-orange-100 active:scale-[0.98]"
                >
                  <Download className="h-4 w-4" />
                  Save graphic
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {shareError ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-700">
          {shareError}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-[11px] font-semibold leading-4 text-slate-500">
          Official schedules and rulings come from tournament staff.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={createShareCard}
            disabled={shareBusy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-xs font-black text-white active:scale-[0.98] disabled:opacity-70"
          >
            <Share2 className="h-4 w-4" />
            {shareBusy ? "Making..." : "Make graphic"}
          </button>
          {group.sourceUrl ? (
            <a
              href={group.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-black text-orange-600"
            >
              Source
            </a>
          ) : null}
        </div>
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
  const displayedRecord = record ?? resultRecordFromOfficialRow(result);
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

function finalResultShareRows(
  group: FollowedFinalResultGroup,
  records: Map<string, TeamRecord>,
  games: Game[],
  teams: Team[],
): FinalResultShareRow[] {
  const placementRows = group.rows.map((result) => {
    const resolvedRecord =
      resultRecordForTeam(result, records, games, teams) ??
      resultRecordFromOfficialRow(result);
    return {
      label: resultPlacementLabel(result),
      placement: result.placement,
      recordText: recordText(resolvedRecord),
      teamName: result.teamNameSnapshot,
    };
  });
  const followedRows = (group.followedTeamsWithoutPlacement ?? []).map(
    (team) => {
      const resolvedRecord = followedTeamRecord(team, records, games);
      return {
        label: "Followed team",
        note: group.hasPostedPlacements
          ? "Not listed in posted gold, silver, or bronze."
          : "Final placement pending.",
        placement: 0,
        recordText: recordText(resolvedRecord),
        teamName: teamDisplayName(team),
      };
    },
  );
  if (placementRows.length > 0) return placementRows.slice(0, 3);
  return followedRows.slice(0, 2);
}

async function renderFinalResultShareImage({
  event,
  group,
  rows,
}: {
  event: TournamentEvent;
  group: FollowedFinalResultGroup;
  rows: FinalResultShareRow[];
}): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("Image generation is only available in the browser.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create the result image.");

  const theme = finalResultPosterTheme(event, group);
  const seed = finalResultPosterSeed(event, group);
  const fontFamily =
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const setFont = (size: number, weight = 800) => {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
  };
  const eventPlace =
    event.city && event.state
      ? `${event.city}, ${event.state}`
      : event.location;
  const eventDate = finalResultShareEventDate(event);
  const statusLabel =
    group.rows.length === 0
      ? "Pending"
      : group.isOfficial
        ? "Official"
        : "Bracket final";
  const displayRows =
    rows.length > 0
      ? rows
      : [
          {
            label: "Final results",
            note: "Final placements not posted yet for this division.",
            placement: 0,
            recordText: "",
            teamName: "Pending",
          },
        ];

  drawPosterBackground(ctx, theme, seed);
  drawPosterLogoBadge(ctx, theme, 806, 48);

  setFont(25, 900);
  ctx.fillStyle = theme.primary;
  ctx.fillText((event.organizer || "AAU BASKETBALL").toUpperCase(), 72, 76);

  setFont(74, 950);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("FINAL RESULTS", 72, 148);
  setFont(96, 950);
  ctx.fillStyle = theme.primary;
  ctx.fillText("ARE IN", 72, 236);
  setFont(48, 950);
  ctx.fillStyle = "#ffffff";
  drawWrappedCanvasText(ctx, theme.headline, 72, 304, 720, 52, 1);

  setFont(22, 900);
  ctx.fillStyle = theme.secondary;
  drawWrappedCanvasText(ctx, theme.subhead, 78, 350, 760, 30, 1);

  fillRoundedRect(ctx, 72, 386, 936, 98, 20, "rgba(3,7,18,0.82)");
  strokeRoundedRect(ctx, 72, 386, 936, 98, 20, theme.stroke, 2);
  fillRoundedRect(ctx, 96, 415, 50, 50, 12, theme.primary);
  setFont(28, 950);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("1", 121, 450);
  ctx.textAlign = "left";
  setFont(22, 950);
  ctx.fillStyle = theme.secondary;
  ctx.fillText("TOURNAMENT", 166, 424);
  setFont(28, 950);
  ctx.fillStyle = "#ffffff";
  drawWrappedCanvasText(ctx, event.name, 166, 458, 560, 32, 1);
  setFont(20, 800);
  ctx.fillStyle = "#cbd5e1";
  drawWrappedCanvasText(
    ctx,
    [eventPlace, eventDate].filter(Boolean).join(" / "),
    166,
    480,
    560,
    24,
    1,
  );
  fillRoundedRect(ctx, 804, 392, 154, 46, 12, theme.primary);
  setFont(18, 950);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(fitCanvasText(ctx, statusLabel.toUpperCase(), 124), 881, 422);
  ctx.textAlign = "left";

  const champion = displayRows.find((row) => row.placement === 1);
  drawPosterPhoneMock(
    ctx,
    theme,
    group,
    displayRows,
    92,
    536,
    seed,
    "champion",
  );
  drawPosterPhoneMock(
    ctx,
    theme,
    group,
    displayRows,
    572,
    536,
    seed + 19,
    "podium",
  );

  fillRoundedRect(ctx, 52, 938, 976, 146, 22, "rgba(3,7,18,0.88)");
  strokeRoundedRect(ctx, 52, 938, 976, 146, 22, theme.stroke, 2);
  fillRoundedRect(ctx, 78, 970, 58, 58, 14, theme.primary);
  setFont(34, 950);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("D", 107, 1011);
  ctx.textAlign = "left";
  setFont(22, 950);
  ctx.fillStyle = theme.primary;
  ctx.fillText("DIVISION RESULTS", 158, 986);
  setFont(34, 950);
  ctx.fillStyle = "#ffffff";
  drawWrappedCanvasText(ctx, group.divisionName, 158, 1028, 470, 38, 1);
  setFont(22, 850);
  ctx.fillStyle = "#cbd5e1";
  drawWrappedCanvasText(
    ctx,
    `${group.gradeLevel ?? "Grade TBD"}${group.level ? ` / ${group.level}` : ""}`,
    158,
    1060,
    470,
    28,
    1,
  );
  if (champion) {
    drawChampionMiniCard(ctx, champion, theme, 666, 964);
  } else {
    drawPendingMiniCard(ctx, displayRows[0]!, theme, 666, 964);
  }

  const podiumRows = displayRows.slice(0, 3);
  fillRoundedRect(ctx, 52, 1098, 976, 90, 18, "rgba(3,7,18,0.9)");
  strokeRoundedRect(ctx, 52, 1098, 976, 90, 18, theme.stroke, 2);
  setFont(24, 950);
  ctx.fillStyle = theme.primary;
  ctx.fillText("PODIUM", 84, 1133);
  podiumRows.forEach((row, index) =>
    drawPosterPodiumRow(ctx, row, theme, 218 + index * 264, 1118, 238),
  );

  fillRoundedRect(ctx, 52, 1204, 976, 72, 18, "rgba(3,7,18,0.92)");
  strokeRoundedRect(ctx, 52, 1204, 976, 72, 18, theme.stroke, 2);
  fillRoundedRect(ctx, 80, 1222, 52, 38, 10, theme.primary);
  setFont(24, 950);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("FOLLOW THE WHOLE TOURNAMENT JOURNEY", 156, 1237);
  setFont(20, 800);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(
    "Teams, scores, records, brackets, courts, and final placements.",
    156,
    1262,
  );

  fillRoundedRect(ctx, 52, 1292, 976, 50, 12, theme.primary);
  setFont(38, 950);
  ctx.fillStyle = "#070b16";
  ctx.textAlign = "center";
  ctx.fillText("VISIT COURTWATCHAAU.COM", 540, 1330);
  ctx.textAlign = "left";

  return canvasToPngBlob(canvas);
}

type FinalResultPosterTheme = {
  accentSoft: string;
  backgroundA: string;
  backgroundB: string;
  backgroundC: string;
  glow: string;
  headline: string;
  primary: string;
  secondary: string;
  stroke: string;
  subhead: string;
};

const FINAL_RESULT_POSTER_THEMES: FinalResultPosterTheme[] = [
  {
    accentSoft: "#ffb36b",
    backgroundA: "#070b16",
    backgroundB: "#111827",
    backgroundC: "#1b0802",
    glow: "rgba(255, 94, 10, 0.34)",
    headline: "WHO MADE THE PODIUM?",
    primary: "#ff5f05",
    secondary: "#f8d28b",
    stroke: "rgba(255, 95, 5, 0.56)",
    subhead: "Gold, silver, bronze, and records are posted on Court Watch AAU.",
  },
  {
    accentSoft: "#fed7aa",
    backgroundA: "#050816",
    backgroundB: "#111827",
    backgroundC: "#290b02",
    glow: "rgba(249, 115, 22, 0.32)",
    headline: "WHO TOOK THE HARDWARE?",
    primary: "#f97316",
    secondary: "#ffb36b",
    stroke: "rgba(249, 115, 22, 0.52)",
    subhead: "Official placements, records, and tournament updates.",
  },
  {
    accentSoft: "#fed7aa",
    backgroundA: "#050816",
    backgroundB: "#172033",
    backgroundC: "#2a1203",
    glow: "rgba(249, 115, 22, 0.32)",
    headline: "WHO FINISHED ON TOP?",
    primary: "#ea580c",
    secondary: "#fef3c7",
    stroke: "rgba(234, 88, 12, 0.52)",
    subhead: "Share the final results with the team and families.",
  },
  {
    accentSoft: "#fef3c7",
    backgroundA: "#080b11",
    backgroundB: "#101827",
    backgroundC: "#451a03",
    glow: "rgba(245, 158, 11, 0.3)",
    headline: "WHO EARNED THE MEDALS?",
    primary: "#d97706",
    secondary: "#fed7aa",
    stroke: "rgba(245, 158, 11, 0.5)",
    subhead: "A tournament recap graphic built from live results.",
  },
];

function finalResultPosterSeed(
  event: TournamentEvent,
  group: FollowedFinalResultGroup,
): number {
  return hashText(
    `${event.exposureEventId}:${event.name}:${group.divisionId}:${group.divisionName}`,
  );
}

function finalResultPosterTheme(
  event: TournamentEvent,
  group: FollowedFinalResultGroup,
): FinalResultPosterTheme {
  const seed = finalResultPosterSeed(event, group);
  return FINAL_RESULT_POSTER_THEMES[seed % FINAL_RESULT_POSTER_THEMES.length]!;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function seededUnit(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function drawPosterBackground(
  ctx: CanvasRenderingContext2D,
  theme: FinalResultPosterTheme,
  seed: number,
) {
  const background = ctx.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, theme.backgroundA);
  background.addColorStop(0.55, theme.backgroundB);
  background.addColorStop(1, theme.backgroundC);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1080, 1350);

  drawCanvasGrid(ctx, 1080, 1350);
  drawPosterBasketball(
    ctx,
    -10 + seededUnit(seed, 1) * 50,
    152,
    272,
    theme,
    0.72,
  );
  drawPosterBasketball(ctx, 980, 1018, 328, theme, 0.24);

  for (let index = 0; index < 130; index += 1) {
    const x = seededUnit(seed, index + 10) * 1080;
    const y = seededUnit(seed, index + 110) * 1350;
    const edgeBias = x < 180 || x > 900 || y < 220 || y > 1180;
    const size = 1 + seededUnit(seed, index + 210) * (edgeBias ? 9 : 4);
    ctx.fillStyle = index % 2 === 0 ? theme.glow : "rgba(255,255,255,0.09)";
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255, 95, 5, 0.42)";
  ctx.lineWidth = 7;
  for (let index = 0; index < 9; index += 1) {
    const y = 170 + index * 112 + seededUnit(seed, index + 40) * 30;
    const x = index % 2 === 0 ? 38 : 768;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 150, y - 48);
    ctx.stroke();
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 95, 5, 0.24)";
  for (let index = 0; index < 30; index += 1) {
    const x = seededUnit(seed, index + 300) * 1080;
    const y = seededUnit(seed, index + 390) * 1350;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 42 + seededUnit(seed, index + 470) * 76, y - 18);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPosterBasketball(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  theme: FinalResultPosterTheme,
  opacity = 0.72,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const ballGradient = ctx.createRadialGradient(
    x - radius * 0.28,
    y - radius * 0.3,
    radius * 0.08,
    x,
    y,
    radius,
  );
  ballGradient.addColorStop(0, "#ffb36b");
  ballGradient.addColorStop(0.45, theme.primary);
  ballGradient.addColorStop(1, "#5b1a04");
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(5, 8, 22, 0.68)";
  ctx.lineWidth = Math.max(8, radius * 0.055);
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - radius, y);
  ctx.lineTo(x + radius, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.32, y, radius * 0.34, radius, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + radius * 0.32, y, radius * 0.34, radius, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPosterLogoBadge(
  ctx: CanvasRenderingContext2D,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
) {
  fillRoundedRect(ctx, x, y, 192, 156, 26, "rgba(3,7,18,0.78)");
  strokeRoundedRect(ctx, x, y, 192, 156, 26, "rgba(255,255,255,0.42)", 3);
  drawPosterBasketball(ctx, x + 52, y + 54, 40, theme, 1);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 27px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("COURT", x + 84, y + 50);
  ctx.fillText("WATCH", x + 84, y + 80);
  ctx.fillStyle = theme.primary;
  ctx.font =
    "950 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("AAU", x + 84, y + 112);
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 48, y + 134);
  ctx.lineTo(x + 96, y + 150);
  ctx.lineTo(x + 144, y + 134);
  ctx.stroke();
}

function drawChampionSpotlight(
  ctx: CanvasRenderingContext2D,
  row: FinalResultShareRow,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
) {
  fillRoundedRect(ctx, x, y, 476, 292, 34, "rgba(255,255,255,0.1)");
  strokeRoundedRect(ctx, x, y, 476, 292, 34, theme.glow, 3);
  fillRoundedRect(ctx, x + 30, y + 28, 126, 126, 28, theme.primary);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 42px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1st", x + 93, y + 106);
  ctx.font =
    "900 20px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("GOLD", x + 93, y + 134);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.accentSoft;
  ctx.font =
    "900 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("CHAMPION SPOTLIGHT", x + 180, y + 72);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 44px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedCanvasText(ctx, row.teamName, x + 180, y + 124, 280, 50, 2);
  fillRoundedRect(ctx, x + 30, y + 190, 192, 58, 16, "rgba(5,8,22,0.78)");
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 30px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(row.recordText || "W-L TBD", x + 54, y + 229);
  ctx.fillStyle = theme.secondary;
  ctx.font =
    "900 14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("OVERALL RECORD", x + 246, y + 226);
}

function drawPendingSpotlight(
  ctx: CanvasRenderingContext2D,
  row: FinalResultShareRow,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
) {
  fillRoundedRect(ctx, x, y, 476, 292, 34, "rgba(255,255,255,0.1)");
  strokeRoundedRect(ctx, x, y, 476, 292, 34, theme.glow, 3);
  fillRoundedRect(ctx, x + 34, y + 36, 92, 92, 22, theme.primary);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 34px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("TBD", x + 158, y + 90);
  ctx.fillStyle = "#e2e8f0";
  ctx.font =
    "850 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedCanvasText(
    ctx,
    row.note ?? row.teamName,
    x + 158,
    y + 132,
    330,
    32,
    3,
  );
}

function drawChampionMiniCard(
  ctx: CanvasRenderingContext2D,
  row: FinalResultShareRow,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
) {
  fillRoundedRect(ctx, x, y, 294, 76, 16, "rgba(255,255,255,0.06)");
  strokeRoundedRect(ctx, x, y, 294, 76, 16, theme.stroke, 2);
  fillRoundedRect(ctx, x + 16, y + 16, 62, 44, 12, theme.primary);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1st", x + 47, y + 45);
  ctx.textAlign = "left";
  ctx.fillStyle = theme.secondary;
  ctx.font =
    "950 15px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("CHAMPION", x + 96, y + 30);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(fitCanvasText(ctx, row.teamName, 150), x + 96, y + 58);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 22px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(row.recordText || "TBD", x + 276, y + 48);
  ctx.textAlign = "left";
}

function drawPendingMiniCard(
  ctx: CanvasRenderingContext2D,
  row: FinalResultShareRow,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
) {
  fillRoundedRect(ctx, x, y, 294, 76, 16, "rgba(255,255,255,0.06)");
  strokeRoundedRect(ctx, x, y, 294, 76, 16, theme.stroke, 2);
  fillRoundedRect(ctx, x + 16, y + 16, 62, 44, 12, theme.primary);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 18px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TBD", x + 47, y + 44);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "900 20px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedCanvasText(
    ctx,
    row.note ?? row.teamName,
    x + 96,
    y + 34,
    168,
    24,
    2,
  );
}

function drawPosterPhoneMock(
  ctx: CanvasRenderingContext2D,
  theme: FinalResultPosterTheme,
  group: FollowedFinalResultGroup,
  rows: FinalResultShareRow[],
  x: number,
  y: number,
  seed: number,
  variant: "champion" | "podium",
) {
  const champion = rows.find((row) => row.placement === 1) ?? rows[0];
  ctx.save();
  ctx.translate(x + 190, y + 196);
  ctx.rotate((seed % 2 === 0 ? -1 : 1) * 0.045);
  fillRoundedRect(ctx, -190, -196, 380, 392, 40, "#050816");
  strokeRoundedRect(ctx, -190, -196, 380, 392, 40, theme.stroke, 5);
  fillRoundedRect(ctx, -166, -164, 332, 326, 18, "#f8fafc");
  fillRoundedRect(ctx, -166, -164, 332, 70, 18, "#101827");
  ctx.fillStyle = theme.accentSoft;
  ctx.font =
    "950 17px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("COURT WATCH AAU", -138, -122);
  fillRoundedRect(ctx, 82, -142, 54, 24, 8, theme.primary);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 12px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(variant === "champion" ? "FINAL" : "TOP 3", 94, -125);
  ctx.fillStyle = "#0f172a";
  ctx.font =
    "950 23px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedCanvasText(ctx, group.divisionName, -138, -52, 250, 26, 2);
  ctx.fillStyle = "#64748b";
  ctx.font =
    "850 15px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedCanvasText(
    ctx,
    `${group.gradeLevel ?? "Grade TBD"}${group.level ? ` / ${group.level}` : ""}`,
    -138,
    4,
    260,
    18,
    1,
  );

  if (variant === "champion") {
    fillRoundedRect(ctx, -138, 38, 276, 126, 18, "#ffffff");
    fillRoundedRect(ctx, -116, 58, 78, 76, 16, theme.primary);
    ctx.fillStyle = "#ffffff";
    ctx.font =
      "950 32px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      champion?.placement ? ordinalRank(champion.placement) : "TBD",
      -77,
      102,
    );
    ctx.font =
      "900 14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(champion?.placement === 1 ? "GOLD" : "RESULT", -77, 122);
    ctx.textAlign = "left";
    ctx.fillStyle = "#0f172a";
    ctx.font =
      "950 22px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    drawWrappedCanvasText(
      ctx,
      champion?.teamName ?? "Pending",
      -20,
      82,
      138,
      26,
      2,
    );
    fillRoundedRect(ctx, -116, 142, 112, 34, 10, "#050816");
    ctx.fillStyle = "#ffffff";
    ctx.font =
      "950 19px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(champion?.recordText || "TBD", -94, 165);
  } else {
    rows.slice(0, 3).forEach((row, index) => {
      const rowY = 34 + index * 58;
      const color =
        row.placement === 1
          ? theme.primary
          : row.placement === 2
            ? "#64748b"
            : "#b45309";
      fillRoundedRect(ctx, -138, rowY, 276, 48, 12, "#ffffff");
      fillRoundedRect(ctx, -124, rowY + 10, 48, 28, 8, color);
      ctx.fillStyle = "#ffffff";
      ctx.font =
        "950 16px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        row.placement > 0 ? ordinalRank(row.placement) : "TBD",
        -100,
        rowY + 30,
      );
      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.font =
        "950 15px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      drawWrappedCanvasText(ctx, row.teamName, -64, rowY + 28, 130, 17, 1);
      ctx.fillStyle = "#64748b";
      ctx.font =
        "950 14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.fillText(row.recordText, 88, rowY + 30);
    });
  }

  fillRoundedRect(ctx, -138, 178, 276, 24, 8, theme.primary);
  ctx.fillStyle = "#050816";
  ctx.font =
    "950 13px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("courtwatchaau.com", 0, 195);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawPosterPodiumRow(
  ctx: CanvasRenderingContext2D,
  row: FinalResultShareRow,
  theme: FinalResultPosterTheme,
  x: number,
  y: number,
  width: number,
) {
  const accent =
    row.placement === 1
      ? theme.primary
      : row.placement === 2
        ? "#64748b"
        : "#b45309";
  fillRoundedRect(ctx, x, y, width, 48, 12, "rgba(255,255,255,0.06)");
  strokeRoundedRect(ctx, x, y, width, 48, 12, "rgba(255,255,255,0.1)", 1);
  fillRoundedRect(ctx, x + 10, y + 9, 48, 30, 8, accent);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 17px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    row.placement > 0 ? ordinalRank(row.placement) : "TBD",
    x + 34,
    y + 30,
  );
  ctx.textAlign = "left";
  ctx.fillStyle = theme.secondary;
  ctx.font =
    "950 11px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(row.label.toUpperCase(), x + 68, y + 19);
  ctx.fillStyle = "#ffffff";
  ctx.font =
    "950 16px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(fitCanvasText(ctx, row.teamName, width - 126), x + 68, y + 39);
  if (row.recordText) {
    ctx.fillStyle = "#64748b";
    ctx.font =
      "950 14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(row.recordText, x + width - 12, y + 30);
    ctx.textAlign = "left";
  }
}

function finalResultShareEventDate(event: TournamentEvent): string {
  const timezone = event.timezone ?? DEFAULT_TOURNAMENT_TIME_ZONE;
  const start = compactTournamentDate(event.startDate, timezone);
  const end =
    event.endDate && event.endDate !== event.startDate
      ? compactTournamentDate(event.endDate, timezone)
      : "";
  return end ? `${start}-${end}` : start;
}

function finalResultShareFilename(
  event: TournamentEvent,
  group: FollowedFinalResultGroup,
): string {
  return `court-watch-aau-${shareFilenamePart(event.name)}-${shareFilenamePart(group.divisionName)}.png`;
}

function shareFilenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
}

function drawCanvasGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 58) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 58) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle?: string,
) {
  ctx.save();
  if (fillStyle) ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
  lineWidth = 1,
) {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawWrappedCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const lines = canvasTextLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function canvasTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0) {
    const remainingWords = words.join(" ");
    if (lines.join(" ") !== remainingWords) {
      lines[lastIndex] = fitCanvasText(ctx, `${lines[lastIndex]}...`, maxWidth);
    }
  }
  const fittedLines = lines.map((line) => fitCanvasText(ctx, line, maxWidth));
  return fittedLines;
}

function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && ctx.measureText(fitted).width > maxWidth) {
    fitted = `${fitted.slice(0, -4)}...`;
  }
  return fitted;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Unable to create the result image."));
    }, "image/png");
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 break-words text-lg font-black leading-tight text-slate-950">
        {value}
      </p>
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
  const [scheduleView, setScheduleView] = useState<"timeline" | "courts">(
    "timeline",
  );
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courtFilter, setCourtFilter] = useState("");
  const [selectedCourtKey, setSelectedCourtKey] = useState("");
  const { records, loading: recordsLoading } = useTeamRecords(eventId);
  const courtsQuery = useQuery({
    queryKey: ["courts", eventId],
    queryFn: () => CourtWatchApi.courts(eventId),
    enabled: Boolean(eventId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
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
      <section className="rounded-lg border border-white/10 bg-white/8 p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScheduleView("timeline")}
            className={clsx(
              "min-h-11 rounded-lg text-sm font-black transition active:scale-95",
              scheduleView === "timeline"
                ? "bg-orange-500 text-white"
                : "bg-slate-950 text-slate-200",
            )}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setScheduleView("courts")}
            className={clsx(
              "min-h-11 rounded-lg text-sm font-black transition active:scale-95",
              scheduleView === "courts"
                ? "bg-orange-500 text-white"
                : "bg-slate-950 text-slate-200",
            )}
          >
            Courts
          </button>
        </div>
      </section>

      {scheduleView === "courts" ? (
        <CourtFinderView
          courts={courtsQuery.data ?? []}
          loading={courtsQuery.isLoading}
          selectedCourtKey={selectedCourtKey}
          onSelectCourt={setSelectedCourtKey}
        />
      ) : (
        <>
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
              {[
                "all",
                "playing_now",
                "upcoming",
                "final",
                "schedule_changed",
              ].map((status) => (
                <FilterButton
                  key={status}
                  active={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                >
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
        </>
      )}
    </div>
  );
}

function CourtFinderView({
  courts,
  loading,
  selectedCourtKey,
  onSelectCourt,
}: {
  courts: CourtSummary[];
  loading: boolean;
  selectedCourtKey: string;
  onSelectCourt: (courtKey: string) => void;
}) {
  const selectedCourt =
    courts.find((court) => court.courtKey === selectedCourtKey) ?? null;
  const activeCourts = courts.filter((court) => court.currentGames.length > 0);
  const visibleCourts = selectedCourt
    ? [selectedCourt]
    : activeCourts.length > 0
      ? activeCourts
      : courts;

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/8 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
          <Gauge className="h-4 w-4 text-orange-300" />
          Court Finder
        </div>
        <select
          value={selectedCourtKey}
          onChange={(event) => onSelectCourt(event.target.value)}
          className="h-11 w-full rounded-lg border border-white/12 bg-slate-950 px-3 text-sm font-semibold text-white"
        >
          <option value="">
            {activeCourts.length > 0 ? "All active courts" : "All courts"}
          </option>
          {courts.map((court) => (
            <option key={court.courtKey} value={court.courtKey}>
              {courtFinderCourtLabel(court)}
            </option>
          ))}
        </select>
      </section>

      {loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-white/12" />
      ) : null}
      {!loading && courts.length === 0 ? (
        <section className="court-card p-4">
          <h2 className="text-xl font-black text-slate-950">
            No courts posted yet
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Court Watch AAU will show live and upcoming court assignments when
            the tournament source posts games.
          </p>
        </section>
      ) : null}
      {!loading &&
      courts.length > 0 &&
      visibleCourts.length === 0 &&
      selectedCourtKey ? (
        <section className="court-card p-4">
          <h2 className="text-xl font-black text-slate-950">Court not found</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Choose another court from the tournament court list.
          </p>
        </section>
      ) : null}

      {visibleCourts.map((court) => (
        <CourtFinderCard key={court.courtKey} court={court} />
      ))}
    </div>
  );
}

function CourtFinderCard({ court }: { court: CourtSummary }) {
  const displayGames =
    court.currentGames.length > 0
      ? court.currentGames
      : court.upNextGame
        ? [court.upNextGame]
        : court.recentGame
          ? [court.recentGame]
          : [];
  const label =
    court.currentGames.length > 0
      ? "Playing now"
      : court.upNextGame
        ? "Up next"
        : court.recentGame
          ? "Last on court"
          : "No games";

  return (
    <section className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
            {label}
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">
            {court.courtName}
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {court.venueName ?? "Venue TBD"}
          </p>
        </div>
        <div
          className={clsx(
            "rounded-lg px-3 py-2 text-center text-xs font-black uppercase",
            court.currentGames.length > 0
              ? "bg-emerald-500 text-white"
              : "bg-slate-100 text-slate-700",
          )}
        >
          {court.currentGames.length > 0 ? "Live" : "Court"}
        </div>
      </div>

      {displayGames.length > 0 ? (
        <div className="mt-4 space-y-3">
          {displayGames.map((item) => (
            <CourtFinderGameCard key={item.game.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
          No live or upcoming games are posted for this court.
        </p>
      )}
    </section>
  );
}

function CourtFinderGameCard({ item }: { item: CourtFinderGame }) {
  const game = item.game;
  const bracketUrl = bracketUrlFromGame(game);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={game.status} />
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              {game.gameType ?? "Pool"}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-black leading-tight text-slate-950">
            {gameMatchupDisplayName(game)}
          </h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {item.division?.name ??
              divisionNameFromGame(game) ??
              "Division TBD"}
          </p>
          <p className="mt-1 text-sm font-black text-slate-700">
            {formatGameDate(game.startsAt)} <span>{game.scheduledTime}</span>
          </p>
          <GameRecordsLine
            game={game}
            records={EMPTY_RECORDS}
            loading={false}
          />
        </div>
        {game.homeScore !== null && game.awayScore !== null ? (
          <div className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-center text-white">
            <p className="text-lg font-black">
              {game.homeScore}-{game.awayScore}
            </p>
            <p className="text-[10px] font-bold text-orange-300">FINAL</p>
          </div>
        ) : (
          <div className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-center text-white">
            <p className="text-lg font-black">{game.scheduledTime}</p>
            <p className="text-[10px] font-bold">{game.courtName}</p>
          </div>
        )}
      </div>
      {bracketUrl ? (
        <a
          href={bracketUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg bg-slate-100 px-3 text-sm font-black text-slate-800"
        >
          <Trophy className="h-4 w-4 text-orange-500" />
          Official bracket
          <ChevronRight className="h-4 w-4" />
        </a>
      ) : null}
    </article>
  );
}

function courtFinderCourtLabel(court: CourtSummary): string {
  return court.venueName
    ? `${court.courtName} - ${court.venueName}`
    : court.courtName;
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
  const mapsUrl = mapsSearchUrlFromGame(game);
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
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${game.venueName ?? "venue"} in maps`}
              title="Open in maps"
              className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-orange-500 transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-orange-400/50"
              onClick={(event) => handleMapsLinkClick(event, game)}
            >
              <MapPin className="h-4 w-4" />
            </a>
          ) : (
            <MapPin className="h-4 w-4 text-orange-500" />
          )}
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
  accountSession,
  onAccountSessionChange,
  onRefresh,
  timezone,
}: {
  dashboard: DashboardResponse;
  eventId: number | null;
  clientId: string;
  accountSession: AccountSession | null;
  onAccountSessionChange: (session: AccountSession | null) => void;
  onRefresh: () => void;
  timezone?: string | null;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const searchActive = Boolean(deferredSearch);
  const {
    records,
    loading: recordsLoading,
    games: recordGames,
    teams: recordTeams,
  } = useTeamRecords(eventId);
  const teamsQuery = useQuery({
    queryKey: ["teams", clientId, deferredSearch, eventId],
    queryFn: () => CourtWatchApi.teams(deferredSearch, eventId),
    enabled: !searchActive || deferredSearch.length > 0,
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const allTeamsQuery = useQuery({
    queryKey: ["teams", "registered-totals", clientId, eventId],
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
  const scopedSearchTeams = useMemo(
    () => teamsForSelectedEvent(teamsQuery.data ?? [], eventId),
    [teamsQuery.data, eventId],
  );
  const scopedAllTeams = useMemo(
    () => teamsForSelectedEvent(allTeamsQuery.data ?? [], eventId),
    [allTeamsQuery.data, eventId],
  );
  const scopedRecordTeams = useMemo(
    () => teamsForSelectedEvent(recordTeams, eventId),
    [recordTeams, eventId],
  );
  const scopedDashboardFollowedTeams = useMemo(
    () => teamsForSelectedEvent(dashboardFollowedTeams, eventId),
    [dashboardFollowedTeams, eventId],
  );
  const observedFollowedTeams = useMemo(
    () =>
      mergeTeamLists(
        scopedRecordTeams,
        scopedSearchTeams,
        scopedDashboardFollowedTeams,
      ),
    [scopedDashboardFollowedTeams, scopedRecordTeams, scopedSearchTeams],
  );
  const { storedFollowedTeams, rememberFollowedTeam, forgetFollowedTeamById } =
    useStoredFollowedTeams(clientId, eventId, observedFollowedTeams, {
      authoritative: isAccountClientId(clientId),
    });
  const scopedStoredFollowedTeams = useMemo(
    () => teamsForSelectedEvent(storedFollowedTeams, eventId),
    [storedFollowedTeams, eventId],
  );
  const matchingStoredTeams = useMemo(
    () =>
      searchActive
        ? scopedStoredFollowedTeams.filter((team) =>
            teamMatchesSearch(team, deferredSearch),
          )
        : scopedStoredFollowedTeams,
    [deferredSearch, scopedStoredFollowedTeams, searchActive],
  );
  const matchingRecordTeams = useMemo(
    () =>
      searchActive
        ? scopedRecordTeams.filter((team) =>
            teamMatchesSearch(team, deferredSearch),
          )
        : scopedRecordTeams,
    [deferredSearch, scopedRecordTeams, searchActive],
  );
  const knownTeamPool = useMemo(
    () => mergeTeamLists(scopedRecordTeams, scopedSearchTeams, scopedAllTeams),
    [scopedAllTeams, scopedRecordTeams, scopedSearchTeams],
  );
  const trustedKnownTeamPool = useMemo(
    () => teamsWithTrustedFollowState(knownTeamPool, scopedStoredFollowedTeams),
    [knownTeamPool, scopedStoredFollowedTeams],
  );
  const followStateTeams = useMemo(
    () => mergeTeamLists(trustedKnownTeamPool, scopedStoredFollowedTeams),
    [scopedStoredFollowedTeams, trustedKnownTeamPool],
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
    queryClient.invalidateQueries({ queryKey: ["account-stats"] });
  };
  const knownTeamsById = useMemo(
    () => new Map(followStateTeams.map((team) => [team.id, team])),
    [followStateTeams],
  );
  const followTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.followTeam(teamId),
    onMutate: () => {
      markFollowMigrationComplete(clientId);
    },
    onSuccess: (_match, teamId) => {
      const team = knownTeamsById.get(teamId);
      if (!team?.exposureEventId || team.exposureEventId === eventId) {
        rememberFollowedTeam(team);
      }
      refreshSelection();
    },
  });
  const unfollowTeam = useMutation({
    mutationFn: (teamId: string) => CourtWatchApi.unfollowTeam(teamId),
    onMutate: () => {
      markFollowMigrationComplete(clientId);
    },
    onSuccess: (_unused, teamId) => {
      forgetFollowedTeamById(teamId);
      refreshSelection();
    },
  });
  const visibleTeams = useMemo(() => {
    const visiblePool = searchActive
      ? mergeTeamLists(
          scopedSearchTeams,
          matchingRecordTeams,
          matchingStoredTeams,
        )
      : followStateTeams;
    return sortTeamsForDisplay(
      teamsWithTrustedFollowState(visiblePool, scopedStoredFollowedTeams),
    );
  }, [
    followStateTeams,
    matchingRecordTeams,
    matchingStoredTeams,
    scopedSearchTeams,
    scopedStoredFollowedTeams,
    searchActive,
  ]);
  const registeredCountLoading =
    teamsQuery.isLoading && visibleTeams.length === 0;
  const registeredCountLabel = searchActive
    ? `${visibleTeams.length} results`
    : `${visibleTeams.length} registered`;
  const divisionTotals = useMemo(
    () => divisionTotalsForTeams(visibleTeams),
    [visibleTeams],
  );
  const pendingTeamId = String(
    followTeam.variables ?? unfollowTeam.variables ?? "",
  );
  const focusedTeam =
    selectedProgram?.teams.find((team) => team.id === focusedTeamId) ?? null;

  const teamResultsSection = (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-black uppercase tracking-[0.16em] text-orange-300">
          {searchActive ? "Search Results" : "Registered Teams"}
        </h2>
        <span className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs font-black text-white">
          {registeredCountLoading ? "..." : registeredCountLabel}
        </span>
      </div>
      <DivisionTotalsPanel
        totals={divisionTotals}
        loading={registeredCountLoading}
      />
      {registeredCountLoading ? (
        <div className="h-28 animate-pulse rounded-lg bg-white/12" />
      ) : null}
      {!registeredCountLoading && visibleTeams.length === 0 ? (
        <div className="court-card p-4">
          <h3 className="text-lg font-black text-slate-950">
            No matches found
          </h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Try a team name, club name, or division.
          </p>
        </div>
      ) : null}
      {visibleTeams.map((team) => (
        <TeamSearchCard
          key={team.id}
          team={team}
          record={teamRecordForTeam(team, records)}
          recordsLoading={recordsLoading}
          nextGame={nextGameForTeam(team, recordGames) ?? team.nextGame}
          timezone={timezone}
          onFollow={() => followTeam.mutate(team.id)}
          onUnfollow={() => unfollowTeam.mutate(team.id)}
          pending={
            (followTeam.isPending || unfollowTeam.isPending) &&
            pendingTeamId === team.id
          }
        />
      ))}
    </section>
  );

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

      <AccountPanel
        accountSession={accountSession}
        onAccountSessionChange={onAccountSessionChange}
        onRefresh={onRefresh}
      />

      {searchActive ? teamResultsSection : null}

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
                tournamentFinished={isTournamentFinished(dashboard.event)}
                focused={focusedTeamId === team.id}
                onFocus={() => setFocusedTeamId(team.id)}
                onUnfollow={() => {
                  if (focusedTeamId === team.id) setFocusedTeamId(null);
                  unfollowTeam.mutate(team.id);
                }}
                pending={unfollowTeam.isPending && pendingTeamId === team.id}
                timezone={timezone}
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
          tournamentFinished={isTournamentFinished(dashboard.event)}
          timezone={timezone}
        />
      ) : null}

      {!searchActive ? teamResultsSection : null}
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
  options: { authoritative?: boolean } = {},
): {
  storedFollowedTeams: Team[];
  rememberFollowedTeam: (team: Team | undefined) => void;
  forgetFollowedTeamById: (teamId: string) => void;
} {
  const [storedFollowedTeams, setStoredFollowedTeams] = useState<Team[]>([]);
  const [suppressedFollowedIds, setSuppressedFollowedIds] = useState<
    Set<string>
  >(new Set());
  const observedFollowedSignature = useMemo(
    () =>
      observedTeams
        .filter((team) => team.isFollowed)
        .filter((team) => !suppressedFollowedIds.has(team.id))
        .map((team) => `${team.id}:${team.followerCount ?? ""}`)
        .sort()
        .join("|"),
    [observedTeams, suppressedFollowedIds],
  );
  const mergeableObservedTeams = useMemo(
    () => observedTeams.filter((team) => !suppressedFollowedIds.has(team.id)),
    [observedTeams, suppressedFollowedIds],
  );

  useEffect(() => {
    setSuppressedFollowedIds(loadSuppressedFollowedTeamIds(clientId, eventId));
    setStoredFollowedTeams(loadStoredFollowedTeams(clientId, eventId));
  }, [clientId, eventId]);

  useEffect(() => {
    if (!clientId || !eventId) return;
    if (options.authoritative) {
      const nextStoredFollowedTeams = replaceStoredFollowedTeams(
        clientId,
        eventId,
        mergeableObservedTeams,
      );
      setStoredFollowedTeams((current) =>
        followedTeamsStateSignature(current) ===
        followedTeamsStateSignature(nextStoredFollowedTeams)
          ? current
          : nextStoredFollowedTeams,
      );
      return;
    }
    if (observedFollowedSignature.length === 0) return;
    const nextStoredFollowedTeams = mergeStoredFollowedTeams(
      clientId,
      eventId,
      mergeableObservedTeams,
      {
        onlyExistingWhenStored: true,
      },
    );
    setStoredFollowedTeams((current) =>
      followedTeamsStateSignature(current) ===
      followedTeamsStateSignature(nextStoredFollowedTeams)
        ? current
        : nextStoredFollowedTeams,
    );
  }, [
    clientId,
    eventId,
    mergeableObservedTeams,
    observedFollowedSignature,
    options.authoritative,
  ]);

  return {
    storedFollowedTeams,
    rememberFollowedTeam: (team) => {
      if (team) {
        clearSuppressedFollowedTeamId(clientId, eventId, team.id);
        setSuppressedFollowedIds((current) => {
          const next = new Set(current);
          next.delete(team.id);
          return next;
        });
      }
      setStoredFollowedTeams(
        rememberStoredFollowedTeam(clientId, eventId, team),
      );
    },
    forgetFollowedTeamById: (teamId) => {
      suppressFollowedTeamId(clientId, eventId, teamId);
      setSuppressedFollowedIds((current) => new Set(current).add(teamId));
      setStoredFollowedTeams(
        forgetStoredFollowedTeam(clientId, eventId, teamId),
      );
    },
  };
}

function followedTeamsStateSignature(teams: Team[]): string {
  return JSON.stringify(
    teams
      .map((team) => {
        const teamWithGames = team as Team & {
          nextGame?: Pick<Game, "id" | "status" | "startsAt"> | null;
          lastResult?: Pick<Game, "id" | "status" | "updatedAt"> | null;
        };
        return {
          id: team.id,
          name: team.name,
          divisionId: team.divisionId,
          divisionName: team.divisionName,
          followerCount: team.followerCount ?? null,
          isFollowed: Boolean(team.isFollowed),
          record: team.record ?? null,
          nextGameId: teamWithGames.nextGame?.id ?? null,
          nextGameStatus: teamWithGames.nextGame?.status ?? null,
          nextGameStartsAt: teamWithGames.nextGame?.startsAt ?? null,
          lastResultId: teamWithGames.lastResult?.id ?? null,
          lastResultStatus: teamWithGames.lastResult?.status ?? null,
          lastResultUpdatedAt: teamWithGames.lastResult?.updatedAt ?? null,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
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

function teamsForSelectedEvent(teams: Team[], eventId: number | null): Team[] {
  if (!eventId) return teams;
  return teams.filter(
    (team) =>
      typeof team.exposureEventId !== "number" ||
      team.exposureEventId === eventId,
  );
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
  tournamentFinished,
  focused,
  onFocus,
  onUnfollow,
  pending,
  timezone,
}: {
  team: ProgramSummary["teams"][number];
  eventId: number | null;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
  tournamentFinished: boolean;
  focused: boolean;
  onFocus: () => void;
  onUnfollow: () => void;
  pending: boolean;
  timezone?: string | null;
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
          {team.eventName ? (
            <p className="mt-1 text-xs font-black uppercase tracking-[0.08em] text-orange-600">
              {team.eventName}
            </p>
          ) : null}
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
              ? formatTeamNextGameSummary(team, team.nextGame, timezone)
              : tournamentFinished
                ? "Finished"
                : "TBD"
          }
        />
        <Metric
          label="Last"
          value={team.lastResult ? scoreSummary(team.lastResult) : "No result"}
        />
      </div>
      {team.nextGame ? <TeamNextGameLocationLine game={team.nextGame} /> : null}
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
  tournamentFinished,
  timezone,
}: {
  team: ProgramSummary["teams"][number];
  eventId: number | null;
  record: TeamRecord | undefined;
  records: Map<string, TeamRecord>;
  recordsLoading: boolean;
  tournamentFinished: boolean;
  timezone?: string | null;
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
        <Metric
          label="Next"
          value={
            team.nextGame
              ? formatTeamNextGameSummary(team, team.nextGame, timezone)
              : tournamentFinished
                ? "Finished"
                : "TBD"
          }
        />
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
  nextGame,
  timezone,
  onFollow,
  onUnfollow,
  pending,
}: {
  team: Team;
  record: TeamRecord | undefined;
  recordsLoading: boolean;
  nextGame?: Game | null;
  timezone?: string | null;
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
          {nextGame ? (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                Next: {formatTeamNextGameSummary(team, nextGame, timezone)}
              </p>
              <TeamNextGameLocationLine game={nextGame} />
            </>
          ) : null}
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

function TeamNextGameLocationLine({
  game,
}: {
  game: Pick<Game, "venueName" | "courtName">;
}) {
  const location = formatGameLocation(game);
  const mapsUrl = mapsSearchUrlFromGame(game);
  if (!location) return null;

  return (
    <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-black leading-5 text-slate-600">
      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${game.venueName ?? "venue"} in maps`}
          title="Open in maps"
          className="-ml-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-orange-500 transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-orange-400/50"
          onClick={(event) => handleMapsLinkClick(event, game)}
        >
          <MapPin className="h-3.5 w-3.5" />
        </a>
      ) : (
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
      )}
      <span className="min-w-0">{location}</span>
    </p>
  );
}

function FollowerCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1 ? "follower" : "followers";
  return (
    <span className="shrink-0 rounded-md bg-orange-100 px-2 py-1 text-[11px] font-black text-orange-700">
      {count} {label}
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
      <div className="mb-4">
        <PushAlertsCard />
      </div>
      <AlertList alerts={alerts} games={games} />
    </section>
  );
}

type PushSupportState = {
  supported: boolean;
  message: string | null;
};

function PushAlertsCard() {
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [support, setSupport] = useState<PushSupportState>({
    supported: true,
    message: null,
  });
  const [isSubscribing, setIsSubscribing] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const enabled = permission === "granted";
  const canEnable = support.supported && Boolean(publicKey) && !isSubscribing;

  useEffect(() => {
    const nextSupport = pushSupportState();
    setSupport(nextSupport);
    if (!nextSupport.supported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const subscribe = async () => {
    try {
      if (!publicKey) {
        setPushMessage("Push alert keys are not configured yet.");
        return;
      }
      setIsSubscribing(true);
      const subscription = await requestPushSubscription(publicKey);
      await CourtWatchApi.subscribePush(
        subscription,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setPermission(Notification.permission);
      setPushMessage(
        "Audible alerts are enabled. Control sound in your phone notification settings.",
      );
    } catch (error) {
      setPermission(
        typeof Notification === "undefined"
          ? "unsupported"
          : Notification.permission,
      );
      setPushMessage(
        error instanceof Error
          ? error.message
          : "Unable to enable notifications.",
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <section className="rounded-lg border border-orange-100 bg-orange-50/80 p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-500 text-white">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-slate-950">
              Audible alerts
            </h3>
            <span
              className={clsx(
                "rounded-md px-2 py-1 text-[11px] font-black uppercase",
                enabled
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-white text-slate-500",
              )}
            >
              {enabled ? "Enabled" : "Optional"}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
            Get score, court, bracket, and game-change notifications with your
            device&apos;s normal alert sound when sounds are allowed.
          </p>
          <p className="mt-2 rounded-md bg-white px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-500">
            iPhone: add Court Watch AAU to your Home Screen, enable alerts here,
            then use Settings &gt; Notifications &gt; Court Watch AAU to turn
            sounds on or off.
          </p>
          {support.message ? (
            <p className="mt-2 text-xs font-bold leading-5 text-orange-700">
              {support.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={subscribe}
            disabled={!canEnable}
            className={clsx(
              "mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-black active:scale-[0.99]",
              canEnable
                ? "bg-slate-950 text-white"
                : "cursor-not-allowed bg-slate-200 text-slate-500",
            )}
          >
            <Bell className="h-4 w-4" />
            {isSubscribing
              ? "Enabling..."
              : enabled
                ? "Refresh alert permission"
                : "Enable audible alerts"}
          </button>
          {pushMessage ? (
            <p className="mt-2 text-xs font-bold leading-5 text-slate-600">
              {pushMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function pushSupportState(): PushSupportState {
  if (typeof window === "undefined") {
    return { supported: false, message: "Checking notification support." };
  }
  if (!("Notification" in window)) {
    return {
      supported: false,
      message: "This browser does not support web notifications.",
    };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return {
      supported: false,
      message:
        "On iPhone, open the installed Home Screen app to enable web push alerts.",
    };
  }
  return { supported: true, message: null };
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
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const adminUsersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: CourtWatchApi.adminUsers,
    staleTime: 60_000,
    refetchInterval: PASSIVE_DATA_REFETCH_MS,
    refetchIntervalInBackground: true,
  });
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

  return (
    <div className="space-y-4">
      <section className="court-card p-4">
        <h2 className="text-2xl font-black text-slate-950">Dev Tools</h2>
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
      </section>

      <section className="court-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
              Registered Users
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              {adminUsersQuery.data?.total ?? "Loading"} accounts
            </h2>
          </div>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-950 text-orange-300">
            <Users className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
          {adminUsersQuery.isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ) : null}
          {adminUsersQuery.data?.users.map((user) => (
            <div
              key={user.id}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <p className="break-all text-sm font-black text-slate-950">
                {user.email ?? "No email"}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {user.displayName ? `${user.displayName} / ` : ""}
                {formatShortDateTime(user.createdAt)}
              </p>
            </div>
          ))}
          {!adminUsersQuery.isLoading &&
          (adminUsersQuery.data?.users.length ?? 0) === 0 ? (
            <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold text-slate-600">
              No registered users yet.
            </p>
          ) : null}
          {adminUsersQuery.isError ? (
            <p className="rounded-lg bg-orange-50 p-3 text-sm font-semibold text-orange-700">
              Unable to load registered users.
            </p>
          ) : null}
        </div>
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

function AccountPanel({
  accountSession,
  onAccountSessionChange,
  onRefresh,
}: {
  accountSession: AccountSession | null;
  onAccountSessionChange: (session: AccountSession | null) => void;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetCodeRequested, setResetCodeRequested] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("resetToken");
    if (!token) return;
    setMode("forgot");
    setResetToken(token);
    setResetCodeRequested(true);
    setAccountMessage("Reset code loaded. Enter a new password to finish.");
  }, []);

  const applySession = async (response: AccountSession) => {
    const session = saveAccountSession(response);
    onAccountSessionChange(session);
    setPassword("");
    setResetPassword("");
    setResetToken("");
    setAccountMessage("Signed in. Followed teams sync automatically.");
    onRefresh();
  };

  const registerMutation = useMutation({
    mutationFn: () =>
      CourtWatchApi.registerAccount({
        email,
        password,
        displayName: displayName.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: (response) => {
      void applySession(response);
    },
    onError: (error) => setAccountMessage(errorText(error)),
  });

  const loginMutation = useMutation({
    mutationFn: () => CourtWatchApi.loginAccount({ email, password }),
    onSuccess: (response) => {
      void applySession(response);
    },
    onError: (error) => setAccountMessage(errorText(error)),
  });

  const forgotMutation = useMutation({
    mutationFn: () => CourtWatchApi.forgotPassword(resetEmail || email),
    onSuccess: (response) => {
      if (response.resetToken) {
        setResetToken(response.resetToken);
        setResetCodeRequested(true);
        setAccountMessage("Reset code created. Enter a new password below.");
        return;
      }
      setResetToken("");
      setResetPassword("");
      setResetCodeRequested(response.emailSent);
      setAccountMessage(
        response.emailSent
          ? "Check your email for the reset code, then paste it below."
          : "No reset email was sent. Use the same email you used to create your Court Watch account, or create a free account first.",
      );
    },
    onError: (error) => setAccountMessage(errorText(error)),
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      CourtWatchApi.resetPassword({
        token: resetToken,
        password: resetPassword,
      }),
    onSuccess: () => {
      setPassword("");
      setResetPassword("");
      setResetToken("");
      setResetCodeRequested(false);
      setMode("login");
      setAccountMessage("Password updated. Sign in with the new password.");
    },
    onError: (error) =>
      setAccountMessage(
        resetToken.trim().length < 16
          ? "Paste the reset code from your email before resetting your password."
          : errorText(error),
      ),
  });

  const busy =
    registerMutation.isPending ||
    loginMutation.isPending ||
    forgotMutation.isPending ||
    resetMutation.isPending;

  const signOut = () => {
    clearAccountSession();
    onAccountSessionChange(null);
    setAccountMessage(
      "Signed out. Saved teams on this device are still kept here.",
    );
    onRefresh();
  };
  const accountModes: Array<{
    id: "login" | "register" | "forgot";
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "login", label: "Sign in", icon: LogIn },
    { id: "register", label: "Create", icon: UserPlus },
    { id: "forgot", label: "Forgot", icon: KeyRound },
  ];

  return (
    <section className="court-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">
            Free Account Sync
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">
            Save teams across devices
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
            Sign in to share your followed teams across phone, tablet, and
            computer. If you skip this, teams stay saved on this device only.
          </p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-950 text-orange-300">
          <Users className="h-5 w-5" />
        </div>
      </div>

      {accountSession ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            Signed in
          </p>
          <p className="mt-1 break-all text-sm font-black text-slate-950">
            {accountSession.user.email}
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            Followed teams sync automatically on every phone, tablet, or
            computer where you sign in.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 active:scale-[0.99] disabled:opacity-60 sm:col-span-2"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
            {accountModes.map(({ id, label, icon: TabIcon }) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={clsx(
                    "flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-black transition active:scale-[0.98]",
                    active ? "bg-slate-950 text-white" : "text-slate-600",
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {mode === "login" || mode === "register" ? (
            <div className="mt-3 space-y-2">
              <AccountInput
                icon={Mail}
                value={email}
                onChange={setEmail}
                placeholder="Email"
                type="email"
                autoComplete="email"
              />
              {mode === "register" ? (
                <AccountInput
                  icon={Users}
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Name optional"
                  autoComplete="name"
                />
              ) : null}
              <AccountInput
                icon={KeyRound}
                value={password}
                onChange={setPassword}
                placeholder="Password"
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
              />
              <button
                type="button"
                disabled={busy || !email || password.length < 8}
                onClick={() =>
                  mode === "register"
                    ? registerMutation.mutate()
                    : loginMutation.mutate()
                }
                className="min-h-11 w-full rounded-lg bg-orange-500 px-4 text-sm font-black text-white active:scale-[0.99] disabled:opacity-50"
              >
                {busy
                  ? "Working..."
                  : mode === "register"
                    ? "Create free account"
                    : "Sign in"}
              </button>
            </div>
          ) : null}

          {mode === "forgot" ? (
            <div className="mt-3 space-y-2">
              <AccountInput
                icon={Mail}
                value={resetEmail}
                onChange={setResetEmail}
                placeholder="Account email"
                type="email"
                autoComplete="email"
              />
              <p className="rounded-lg bg-slate-100 p-3 text-xs font-bold leading-5 text-slate-600">
                Enter the email you used when creating your free Court Watch
                account. If that email is registered, a reset code will be sent
                there.
              </p>
              <button
                type="button"
                disabled={busy || !(resetEmail || email)}
                onClick={() => forgotMutation.mutate()}
                className="min-h-11 w-full rounded-lg bg-slate-950 px-4 text-sm font-black text-white active:scale-[0.99] disabled:opacity-50"
              >
                Send reset code
              </button>
              {resetCodeRequested || resetToken ? (
                <>
                  <AccountInput
                    icon={KeyRound}
                    value={resetToken}
                    onChange={setResetToken}
                    placeholder="Reset code from email"
                    autoComplete="one-time-code"
                  />
                  <AccountInput
                    icon={KeyRound}
                    value={resetPassword}
                    onChange={setResetPassword}
                    placeholder="New password"
                    type="password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    disabled={
                      busy ||
                      resetToken.trim().length < 16 ||
                      resetPassword.length < 8
                    }
                    onClick={() => resetMutation.mutate()}
                    className="min-h-11 w-full rounded-lg bg-orange-500 px-4 text-sm font-black text-white active:scale-[0.99] disabled:opacity-50"
                  >
                    Reset password
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {accountMessage ? (
        <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-700">
          {accountMessage}
        </p>
      ) : null}
    </section>
  );
}

function AccountInput({
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-orange-500">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
      />
    </label>
  );
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong.";
  try {
    const parsed = JSON.parse(error.message) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      "fieldErrors" in parsed.error
    ) {
      const fieldErrors = (parsed.error as { fieldErrors?: unknown })
        .fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const messages = Object.values(fieldErrors)
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .filter((value): value is string => typeof value === "string");
        if (messages.length > 0) return messages.join(" ");
      }
    }
  } catch {
    // The API sometimes returns plain text from proxies.
  }
  return error.message;
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
  tabs,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  tabs: Array<{
    id: Tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <nav className="courtwatch-bottom-tabs fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#07111f]/95 px-2 pt-1.5 backdrop-blur">
      <div
        className="mx-auto grid max-w-[520px] gap-1"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        }}
      >
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
                "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg text-[8px] font-black leading-none transition active:scale-95 sm:min-h-14 sm:text-[11px]",
                active ? "bg-orange-500 text-white" : "text-slate-300",
              )}
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="block w-full text-center">
                {tab.id === "dashboard" ? (
                  <>
                    Dash
                    <br />
                    board
                  </>
                ) : tab.id === "settings" ? (
                  <>
                    Dev
                    <br />
                    Tools
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
          : status === "awaiting_bracket" || status === "unknown"
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

function isTournamentFinished(
  event: Pick<TournamentEvent, "endDate" | "status" | "timezone">,
): boolean {
  if (event.status === "completed") return true;
  const todayKey = dateKeyInTimeZone(
    new Date(),
    event.timezone || DEFAULT_TOURNAMENT_TIME_ZONE,
  );
  return event.endDate < todayKey;
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

function sortTeamsForDisplay(teams: Team[]): Team[] {
  return [...teams].sort((left, right) => {
    return (
      teamDisplayName(left).localeCompare(teamDisplayName(right), "en-US", {
        numeric: true,
        sensitivity: "base",
      }) ||
      (left.divisionName ?? "").localeCompare(
        right.divisionName ?? "",
        "en-US",
        { numeric: true, sensitivity: "base" },
      ) ||
      left.id.localeCompare(right.id)
    );
  });
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
  const candidates: Array<TeamRecord | undefined> = [
    hasRecordActivity(result.record) ? result.record : undefined,
    resultRecordFromOfficialRow(result),
  ];

  if (result.teamId) {
    const storedRecord = records.get(result.teamId);
    if (hasRecordActivity(storedRecord)) candidates.push(storedRecord);

    const gameRecord = recordFromGamesForTeamId(result.teamId, games);
    if (hasRecordActivity(gameRecord)) candidates.push(gameRecord);
  }

  const matchedTeam = findResultTeam(result, teams);
  if (matchedTeam) {
    const matchedRecord = teamRecordForTeam(matchedTeam, records);
    if (hasRecordActivity(matchedRecord)) candidates.push(matchedRecord);

    const matchedGameRecord = recordFromGamesForTeamId(matchedTeam.id, games);
    if (hasRecordActivity(matchedGameRecord))
      candidates.push(matchedGameRecord);
  }

  const namedRecord = recordFromGamesForTeamName(result, games);
  if (hasRecordActivity(namedRecord)) candidates.push(namedRecord);
  return bestTeamRecord(candidates);
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

function normalizeDisplayText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

function bestTeamRecord(
  records: Array<TeamRecord | undefined>,
): TeamRecord | undefined {
  return records
    .filter((record): record is TeamRecord => hasRecordActivity(record))
    .sort(
      (left, right) => recordCompleteness(right) - recordCompleteness(left),
    )[0];
}

function recordCompleteness(record: TeamRecord): number {
  return Math.max(
    record.gamesScored,
    record.finalGames,
    record.gamesSeen,
    record.wins + record.losses + record.ties,
  );
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
  return Array.from(new Set(dashboardTeams(dashboard).map((team) => team.id)));
}

function dashboardTeams(dashboard: DashboardResponse): Team[] {
  return dashboard.programs.flatMap((program) =>
    program.teams.map((team) => ({ ...team, isFollowed: true })),
  );
}

function isAdminAccount(session: AccountSession | null): boolean {
  return session?.user.email.trim().toLowerCase() === ADMIN_EMAIL;
}

function isAccountClientId(clientId: string | null): boolean {
  return Boolean(clientId?.startsWith("account:"));
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

function markFollowMigrationComplete(clientId: string | null) {
  if (typeof window === "undefined") return;
  const ids = new Set(
    [clientId, stableClientId()].filter((id): id is string => Boolean(id)),
  );
  for (const id of ids) {
    window.localStorage.setItem(
      `courtwatch:follow-migration:${id}`,
      "complete",
    );
    window.localStorage.removeItem(dashboardFollowMigrationStorageKey(id));
  }
}

function loadSuppressedFollowedTeamIds(
  clientId: string | null,
  eventId: number | null,
): Set<string> {
  const key = suppressedFollowedTeamsStorageKey(clientId, eventId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter(
            (teamId): teamId is string => typeof teamId === "string",
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

function suppressFollowedTeamId(
  clientId: string | null,
  eventId: number | null,
  teamId: string,
) {
  writeSuppressedFollowedTeamIds(clientId, eventId, (current) =>
    new Set(current).add(teamId),
  );
}

function clearSuppressedFollowedTeamId(
  clientId: string | null,
  eventId: number | null,
  teamId: string,
) {
  writeSuppressedFollowedTeamIds(clientId, eventId, (current) => {
    const next = new Set(current);
    next.delete(teamId);
    return next;
  });
}

function writeSuppressedFollowedTeamIds(
  clientId: string | null,
  eventId: number | null,
  update: (current: Set<string>) => Set<string>,
) {
  const key = suppressedFollowedTeamsStorageKey(clientId, eventId);
  if (!key || typeof window === "undefined") return;
  const next = Array.from(
    update(loadSuppressedFollowedTeamIds(clientId, eventId)),
  );
  if (next.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(next));
}

function suppressedFollowedTeamsStorageKey(
  clientId: string | null,
  eventId: number | null,
): string | null {
  if (!clientId || !eventId) return null;
  return `courtwatch-aau:v1:suppressed-followed:${encodeURIComponent(
    clientId,
  )}:${eventId}`;
}

function labelStatus(status: string): string {
  if (status === "unknown") return "Awaiting score";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Playing Now", "LIVE")
    .replace("Schedule Changed", "CHANGED")
    .replace("New Game Added", "NEW GAME")
    .replace("Final Placement", "FINAL RESULT");
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

function formatShortDateTime(
  iso: string,
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
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

function formatGameDateOnly(
  iso: string,
  timeZone = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

function formatNextGameSummary(
  game: Pick<Game, "startsAt" | "courtName" | "timezone">,
  fallbackTimeZone: string | null | undefined = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  const timeZone =
    game.timezone ?? fallbackTimeZone ?? DEFAULT_TOURNAMENT_TIME_ZONE;
  return `${formatGameDateOnly(game.startsAt, timeZone)} at ${formatShortTime(
    game.startsAt,
    timeZone,
  )} ${game.courtName ?? "Court TBD"}`;
}

function formatTeamNextGameSummary(
  team: TeamNameDisplayInput & Pick<Team, "id">,
  game: Pick<
    Game,
    | "startsAt"
    | "courtName"
    | "timezone"
    | "homeTeamId"
    | "awayTeamId"
    | "homeTeamNameSnapshot"
    | "awayTeamNameSnapshot"
    | "divisionId"
    | "rawJson"
  >,
  fallbackTimeZone: string | null | undefined = DEFAULT_TOURNAMENT_TIME_ZONE,
): string {
  const timeZone =
    game.timezone ?? fallbackTimeZone ?? DEFAULT_TOURNAMENT_TIME_ZONE;
  const opponent = opponentNameForTeam(team, game);
  const matchup = opponent ? ` vs ${opponent}` : "";
  return `${formatGameDateOnly(game.startsAt, timeZone)} at ${formatShortTime(
    game.startsAt,
    timeZone,
  )}${matchup}, ${game.courtName ?? "Court TBD"}`;
}

function formatGameLocation(
  game: Pick<Game, "venueName" | "courtName">,
): string | null {
  const venue = game.venueName?.trim();
  const court = game.courtName?.trim();
  if (!venue && !court) return null;
  if (venue && court) return `${venue} · ${court}`;
  return venue ?? court ?? null;
}

function mapsSearchUrlFromGame(
  game: Pick<Game, "venueName" | "courtName">,
): string | null {
  const query = mapsSearchQueryFromGame(game);
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query,
  )}`;
}

function handleMapsLinkClick(
  event: {
    defaultPrevented: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    preventDefault: () => void;
  },
  game: Pick<Game, "venueName" | "courtName">,
) {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey
  )
    return;

  const query = mapsSearchQueryFromGame(game);
  if (!query || typeof navigator === "undefined") return;

  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) {
    event.preventDefault();
    window.location.href = `geo:0,0?q=${encodeURIComponent(query)}`;
    return;
  }

  const isAppleTouchDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  if (isAppleTouchDevice) {
    event.preventDefault();
    window.location.href = `https://maps.apple.com/?q=${encodeURIComponent(
      query,
    )}`;
  }
}

function mapsSearchQueryFromGame(
  game: Pick<Game, "venueName" | "courtName">,
): string | null {
  const venue = game.venueName?.trim();
  if (!venue) return null;

  const withoutNotes = venue
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return withoutNotes || venue;
}

function opponentNameForTeam(
  team: TeamNameDisplayInput & Pick<Team, "id">,
  game: Pick<
    Game,
    | "homeTeamId"
    | "awayTeamId"
    | "homeTeamNameSnapshot"
    | "awayTeamNameSnapshot"
    | "divisionId"
    | "rawJson"
  >,
): string | null {
  if (game.homeTeamId === team.id) {
    return gameTeamDisplayName(game.awayTeamNameSnapshot, game, "Opponent TBD");
  }
  if (game.awayTeamId === team.id) {
    return gameTeamDisplayName(game.homeTeamNameSnapshot, game, "Opponent TBD");
  }

  const teamNames = new Set([
    normalizeTeamMatchName(team.name),
    normalizeTeamMatchName(teamDisplayName(team)),
  ]);
  if (teamNames.has(normalizeTeamMatchName(game.homeTeamNameSnapshot))) {
    return gameTeamDisplayName(game.awayTeamNameSnapshot, game, "Opponent TBD");
  }
  if (teamNames.has(normalizeTeamMatchName(game.awayTeamNameSnapshot))) {
    return gameTeamDisplayName(game.homeTeamNameSnapshot, game, "Opponent TBD");
  }
  return null;
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

  if (alert.eventType === "final_placement") {
    const teamName = readString(value, ["teamName", "name", "team"]);
    const placement =
      readString(value, ["placementLabel", "medalLabel"]) ?? "Final placement";
    return teamName ? `${teamName} - ${placement}` : "Final result posted";
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
    readString(value, ["divisionName", "division"]),
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
    case "final_placement": {
      const teamName = readString(value, ["teamName", "name", "team"]);
      const divisionName = readString(value, ["divisionName", "division"]);
      const placement =
        readString(value, ["placementLabel", "medalLabel"]) ??
        "final placement";
      if (teamName && divisionName)
        return `${teamName} posted ${placement} in ${divisionName}.`;
      return "Official final placement was posted by the tournament source.";
    }
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
  game: Pick<Game, "rawJson">,
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

function divisionNameFromGame(game: Pick<Game, "rawJson">): string | null {
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
