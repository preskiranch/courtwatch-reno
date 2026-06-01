"use client";

import {
  applyShotEvent,
  buildShotEvent,
  correctShotEvent,
  createInitialGameSession,
  defaultCourtVisionRules,
  defaultCourtVisionTeams,
  undoLastShot,
  validateCalibrationProfile,
  validateGameReady,
  type CalibrationProfile,
  type CourtVisionMode,
  type CourtVisionTeam,
  type GameRules,
  type GameSession,
  type Point,
  type ScoringZone,
  type ShotEvent,
  type ShotResult,
} from "@courtwatch/core";
import clsx from "clsx";
import {
  Activity,
  Camera,
  Check,
  Download,
  History,
  Home,
  Layers3,
  Play,
  Save,
  Settings,
  ShieldAlert,
  Target,
  Trash2,
  Trophy,
  Undo2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Screen = "home" | "setup" | "camera" | "calibration" | "game" | "history" | "gameover";
type CalibrationTool = "hoop" | "two" | "three" | "out";

const PROFILE_STORAGE_KEY = "courtvision.calibrationProfiles.v1";
const HISTORY_STORAGE_KEY = "courtvision.gameHistory.v1";
const SETTINGS_STORAGE_KEY = "courtvision.settings.v1";
const PREVIEW_SIZE = { width: 100, height: 100 };

const modeLabels: Record<CourtVisionMode, string> = {
  solo: "Solo",
  one_team: "One Team",
  two_team: "Two Team",
};

const defaultProfile = makeDefaultProfile();

export function CourtVisionApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [rules, setRules] = useState<GameRules>(() => defaultCourtVisionRules("two_team"));
  const [teams, setTeams] = useState<CourtVisionTeam[]>(() => defaultCourtVisionTeams());
  const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState(defaultProfile.id);
  const [draftProfile, setDraftProfile] = useState<CalibrationProfile>(defaultProfile);
  const [history, setHistory] = useState<GameSession[]>([]);
  const [session, setSession] = useState<GameSession | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"idle" | "requesting" | "ready" | "denied" | "unavailable">("idle");
  const [cameraWarning, setCameraWarning] = useState("Camera preview is optional for this MVP. Debug mode can test scoring end-to-end.");
  const [calibrationTool, setCalibrationTool] = useState<CalibrationTool>("hoop");
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const storedProfiles = loadJson<CalibrationProfile[]>(PROFILE_STORAGE_KEY, []);
    const storedHistory = loadJson<GameSession[]>(HISTORY_STORAGE_KEY, []);
    const storedSettings = loadJson<{ rules?: GameRules; teams?: CourtVisionTeam[]; selectedProfileId?: string }>(
      SETTINGS_STORAGE_KEY,
      {},
    );
    const nextProfiles = storedProfiles.length > 0 ? storedProfiles : [defaultProfile];
    setProfiles(nextProfiles);
    setHistory(storedHistory);
    if (storedSettings.rules) setRules(storedSettings.rules);
    if (storedSettings.teams) setTeams(storedSettings.teams);
    const profileId = storedSettings.selectedProfileId ?? nextProfiles[0]?.id ?? defaultProfile.id;
    setSelectedProfileId(profileId);
    setDraftProfile(nextProfiles.find((profile) => profile.id === profileId) ?? nextProfiles[0] ?? defaultProfile);
  }, []);

  useEffect(() => {
    saveJson(SETTINGS_STORAGE_KEY, { rules, teams, selectedProfileId });
  }, [rules, selectedProfileId, teams]);

  useEffect(() => {
    saveJson(PROFILE_STORAGE_KEY, profiles);
  }, [profiles]);

  useEffect(() => {
    saveJson(HISTORY_STORAGE_KEY, history.slice(0, 25));
  }, [history]);

  useEffect(() => {
    if (!session?.winnerTeamId || !session.buzzerTriggered) return;
    playBuzzer();
    setHistory((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== session.id);
      return [session, ...withoutDuplicate].slice(0, 25);
    });
    setScreen("gameover");
  }, [session]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const pendingShot = findLatestPendingShot(session?.shots ?? []);
  const winnerTeam = session?.teams.find((team) => team.id === session.winnerTeamId) ?? null;

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unavailable");
      setCameraWarning("Camera APIs are unavailable in this browser. Manual and debug scoring still work.");
      return;
    }

    try {
      setCameraStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus("ready");
      setCameraWarning("Keep the phone fixed. Recalibrate if the view moves, zooms, or cuts off the hoop.");
    } catch {
      setCameraStatus("denied");
      setCameraWarning("Camera permission was not granted. Use debug shots or manual score controls.");
    }
  }, []);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function updateRules(patch: Partial<GameRules>) {
    setRules((current) => ({ ...current, ...patch }));
  }

  function updateMode(mode: CourtVisionMode) {
    const nextRules = { ...rules, mode };
    setRules(nextRules);
    if (mode === "solo") {
      setTeams([{ id: "solo", name: "Solo", colorName: "Orange", colorHex: "#f97316" }]);
    } else if (mode === "one_team") {
      setTeams([defaultCourtVisionTeams()[0] ?? teams[0] ?? { id: "team-blue", name: "Blue", colorName: "Blue", colorHex: "#2563eb" }]);
    } else {
      setTeams(defaultCourtVisionTeams());
    }
  }

  function saveProfile(profile: CalibrationProfile) {
    const updated = { ...profile, updatedAt: Date.now() };
    setProfiles((current) => {
      const exists = current.some((item) => item.id === updated.id);
      return exists ? current.map((item) => (item.id === updated.id ? updated : item)) : [updated, ...current];
    });
    setSelectedProfileId(updated.id);
    setDraftProfile(updated);
    setToast("Calibration profile saved");
  }

  function deleteProfile(profileId: string) {
    setProfiles((current) => {
      const next = current.filter((profile) => profile.id !== profileId);
      if (selectedProfileId === profileId) {
        const fallback = next[0] ?? defaultProfile;
        setSelectedProfileId(fallback.id);
        setDraftProfile(fallback);
      }
      return next.length > 0 ? next : [defaultProfile];
    });
  }

  function startGame() {
    const profile = selectedProfile ?? draftProfile;
    const errors = validateGameReady({ profile, rules, teams });
    if (errors.length > 0) {
      setToast(errors[0] ?? "Game setup is incomplete");
      return;
    }
    const newSession = createInitialGameSession({
      id: makeId("game"),
      rules,
      teams,
      calibrationProfileId: profile.id,
    });
    setSession(newSession);
    setScreen("game");
  }

  function addShot(params: {
    location: Point;
    result: ShotResult;
    teamId?: string;
    confidence?: number;
    source: "debug" | "manual";
  }) {
    if (!session) return;
    const event = buildShotEvent(
      {
        teamId: params.teamId,
        shotLocation: params.location,
        result: params.result,
        confidence: params.confidence ?? 1,
        source: params.source,
      },
      selectedProfile,
      session.rules,
    );
    setSession(applyShotEvent(session, event));
  }

  function applyCorrection(shotId: string, patch: Partial<Pick<ShotEvent, "teamId" | "zone" | "result" | "points">>) {
    if (!session) return;
    setSession(correctShotEvent(session, shotId, { ...patch, needsConfirmation: false }));
  }

  function undo() {
    if (!session) return;
    setSession(undoLastShot(session));
  }

  function handleCalibrationClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const point = {
      x: Math.round(((event.clientX - rect.left) / rect.width) * PREVIEW_SIZE.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * PREVIEW_SIZE.height),
    };
    setDraftProfile((current) => editProfileAtPoint(current, calibrationTool, point));
  }

  const validation = validateCalibrationProfile(draftProfile);

  return (
    <main className="min-h-dvh bg-[#07111f] text-slate-50">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col border-x border-white/10 bg-[#091522]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#091522]/95 px-4 pb-3 pt-[max(0.85rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <button
              className="flex items-center gap-2 text-left"
              onClick={() => setScreen("home")}
              type="button"
            >
              <span className="grid size-10 place-items-center rounded-lg bg-orange-500 text-slate-950">
                <Target className="size-5" />
              </span>
              <span>
                <span className="block text-base font-black leading-tight">CourtVision</span>
                <span className="block text-xs font-semibold text-slate-400">Scorekeeper MVP</span>
              </span>
            </button>
            <StatusPill status={cameraStatus} />
          </div>
          {toast ? (
            <button
              className="mt-3 w-full rounded-lg border border-orange-300/35 bg-orange-400/12 px-3 py-2 text-left text-xs font-semibold text-orange-100"
              onClick={() => setToast(null)}
              type="button"
            >
              {toast}
            </button>
          ) : null}
        </header>

        <section className="flex-1 overflow-y-auto px-4 py-4">
          {screen === "home" ? (
            <HomeScreen
              profiles={profiles}
              historyCount={history.length}
              onStart={() => setScreen("setup")}
              onPractice={() => {
                updateMode("solo");
                setScreen("setup");
              }}
              onCalibration={() => setScreen("calibration")}
              onHistory={() => setScreen("history")}
            />
          ) : null}

          {screen === "setup" ? (
            <SetupScreen
              rules={rules}
              teams={teams}
              selectedProfile={selectedProfile}
              profiles={profiles}
              onModeChange={updateMode}
              onRulesChange={updateRules}
              onTeamsChange={setTeams}
              onProfileChange={(profileId) => {
                const profile = profiles.find((item) => item.id === profileId);
                setSelectedProfileId(profileId);
                if (profile) setDraftProfile(profile);
              }}
              onCamera={() => setScreen("camera")}
              onStart={startGame}
            />
          ) : null}

          {screen === "camera" ? (
            <CameraSetupScreen
              cameraStatus={cameraStatus}
              cameraWarning={cameraWarning}
              videoRef={videoRef}
              selectedProfile={selectedProfile}
              onRequestCamera={requestCamera}
              onCalibrate={() => setScreen("calibration")}
              onStart={startGame}
            />
          ) : null}

          {screen === "calibration" ? (
            <CalibrationScreen
              draftProfile={draftProfile}
              profiles={profiles}
              selectedTool={calibrationTool}
              validation={validation}
              onToolChange={setCalibrationTool}
              onDraftChange={setDraftProfile}
              onSave={() => saveProfile(draftProfile)}
              onDelete={deleteProfile}
              onCanvasClick={handleCalibrationClick}
            />
          ) : null}

          {screen === "game" && session ? (
            <GameScreen
              session={session}
              teams={session.teams}
              profile={selectedProfile}
              pendingShot={pendingShot}
              cameraStatus={cameraStatus}
              videoRef={videoRef}
              onRequestCamera={requestCamera}
              onShot={addShot}
              onUndo={undo}
              onCorrection={applyCorrection}
              onHistory={() => setScreen("history")}
            />
          ) : null}

          {screen === "gameover" && session ? (
            <GameOverScreen
              session={session}
              winnerTeam={winnerTeam}
              onNewGame={() => setScreen("setup")}
              onHistory={() => setScreen("history")}
              onExport={() => downloadJson(session)}
            />
          ) : null}

          {screen === "history" ? (
            <HistoryScreen
              sessions={history}
              onReplay={(item) => {
                setSession(item);
                setScreen(item.winnerTeamId ? "gameover" : "game");
              }}
              onClear={() => setHistory([])}
            />
          ) : null}
        </section>

        <BottomNav active={screen} onNavigate={setScreen} hasSession={Boolean(session)} />
      </div>
    </main>
  );
}

function HomeScreen(props: {
  profiles: CalibrationProfile[];
  historyCount: number;
  onStart: () => void;
  onPractice: () => void;
  onCalibration: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950">
        <div className="relative aspect-[4/3] court-line-bg">
          <div className="absolute inset-4 rounded-lg border-2 border-orange-300/70">
            <div className="absolute left-1/2 top-4 h-10 w-16 -translate-x-1/2 rounded-b-full border-2 border-teal-300/70 border-t-0" />
            <div className="absolute inset-x-8 bottom-8 h-24 rounded-t-full border-2 border-white/20 border-b-0" />
            <div className="absolute left-1/2 top-3 size-5 -translate-x-1/2 rounded-full border-2 border-orange-400 bg-orange-400/20" />
          </div>
          <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2">
            <Metric label="Profiles" value={String(props.profiles.length)} />
            <Metric label="Saved games" value={String(props.historyCount)} />
          </div>
        </div>
      </div>
      <div className="grid gap-3">
        <PrimaryButton icon={Play} label="Start New Game" onClick={props.onStart} />
        <ActionButton icon={Target} label="Practice Mode" onClick={props.onPractice} />
        <ActionButton icon={Layers3} label="Calibration Profiles" onClick={props.onCalibration} />
        <ActionButton icon={History} label="Game History" onClick={props.onHistory} />
        <ActionButton icon={Settings} label="Settings" onClick={props.onStart} />
      </div>
      <Panel>
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-orange-300" />
          <p className="text-sm leading-6 text-slate-300">
            AI scoring is wired through pluggable interfaces. This MVP uses browser camera preview, calibration geometry, deterministic scoring, and debug/manual shot events.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function SetupScreen(props: {
  rules: GameRules;
  teams: CourtVisionTeam[];
  selectedProfile: CalibrationProfile | null;
  profiles: CalibrationProfile[];
  onModeChange: (mode: CourtVisionMode) => void;
  onRulesChange: (patch: Partial<GameRules>) => void;
  onTeamsChange: (teams: CourtVisionTeam[]) => void;
  onProfileChange: (profileId: string) => void;
  onCamera: () => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Users} title="Game Setup" />
      <Panel>
        <Label>Mode</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["solo", "one_team", "two_team"] as CourtVisionMode[]).map((mode) => (
            <button
              className={clsx(
                "rounded-lg border px-2 py-3 text-sm font-black",
                props.rules.mode === mode
                  ? "border-orange-300 bg-orange-400 text-slate-950"
                  : "border-white/10 bg-white/5 text-slate-200",
              )}
              key={mode}
              onClick={() => props.onModeChange(mode)}
              type="button"
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
      </Panel>
      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target score">
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-base font-bold text-white"
              min={1}
              onChange={(event) => props.onRulesChange({ targetScore: Number(event.target.value) || 1 })}
              type="number"
              value={props.rules.targetScore}
            />
          </Field>
          <Field label="Shot clock">
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-base font-bold text-white"
              min={0}
              onChange={(event) =>
                props.onRulesChange({
                  shotClockSeconds: Number(event.target.value) > 0 ? Number(event.target.value) : undefined,
                })
              }
              placeholder="Off"
              type="number"
              value={props.rules.shotClockSeconds ?? ""}
            />
          </Field>
        </div>
        <ToggleRow label="Win by 2" checked={props.rules.winByTwo} onChange={(winByTwo) => props.onRulesChange({ winByTwo })} />
        <ToggleRow label="2-point scoring" checked={props.rules.twoPointersEnabled} onChange={(twoPointersEnabled) => props.onRulesChange({ twoPointersEnabled })} />
        <ToggleRow label="3-point scoring" checked={props.rules.threePointersEnabled} onChange={(threePointersEnabled) => props.onRulesChange({ threePointersEnabled })} />
        <ToggleRow label="Game-ending buzzer" checked={props.rules.buzzerEnabled} onChange={(buzzerEnabled) => props.onRulesChange({ buzzerEnabled })} />
      </Panel>
      {props.rules.mode !== "solo" ? (
        <Panel>
          <Label>Teams and colors</Label>
          <div className="space-y-3">
            {props.teams.map((team, index) => (
              <div className="grid grid-cols-[1fr_3.5rem] gap-3" key={team.id}>
                <input
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
                  onChange={(event) =>
                    props.onTeamsChange(
                      props.teams.map((item, teamIndex) =>
                        teamIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                  value={team.name}
                />
                <input
                  aria-label={`${team.name} color`}
                  className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 p-1"
                  onChange={(event) =>
                    props.onTeamsChange(
                      props.teams.map((item, teamIndex) =>
                        teamIndex === index ? { ...item, colorHex: event.target.value } : item,
                      ),
                    )
                  }
                  type="color"
                  value={team.colorHex}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-400">
            Team color calibration is deterministic nearest-color matching until a real player tracker is plugged in.
          </p>
        </Panel>
      ) : null}
      <Panel>
        <Field label="Calibration profile">
          <select
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            onChange={(event) => props.onProfileChange(event.target.value)}
            value={props.selectedProfile?.id ?? ""}
          >
            {props.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </Field>
      </Panel>
      <div className="grid grid-cols-2 gap-3">
        <ActionButton icon={Camera} label="Camera Setup" onClick={props.onCamera} />
        <PrimaryButton icon={Play} label="Start Game" onClick={props.onStart} />
      </div>
    </div>
  );
}

function CameraSetupScreen(props: {
  cameraStatus: string;
  cameraWarning: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  selectedProfile: CalibrationProfile | null;
  onRequestCamera: () => void;
  onCalibrate: () => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Camera} title="Camera Setup" />
      <CameraPreview videoRef={props.videoRef} profile={props.selectedProfile} active={props.cameraStatus === "ready"} />
      <Panel>
        <ul className="space-y-2 text-sm leading-6 text-slate-300">
          <li>Place the phone where the hoop, shooter release area, and arc are visible.</li>
          <li>Keep it fixed for the full game. If it moves, recalibrate.</li>
          <li>Use debug/manual controls when confidence is low or camera permission is unavailable.</li>
        </ul>
        <p className="mt-3 rounded-lg border border-orange-300/25 bg-orange-400/10 px-3 py-2 text-xs font-semibold text-orange-100">
          {props.cameraWarning}
        </p>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <PrimaryButton icon={Camera} label="Preview" onClick={props.onRequestCamera} />
        <ActionButton icon={Layers3} label="Calibrate" onClick={props.onCalibrate} />
        <ActionButton icon={Play} label="Start" onClick={props.onStart} />
      </div>
    </div>
  );
}

function CalibrationScreen(props: {
  draftProfile: CalibrationProfile;
  profiles: CalibrationProfile[];
  selectedTool: CalibrationTool;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  onToolChange: (tool: CalibrationTool) => void;
  onDraftChange: (profile: CalibrationProfile) => void;
  onSave: () => void;
  onDelete: (profileId: string) => void;
  onCanvasClick: (event: React.MouseEvent<SVGSVGElement>) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Layers3} title="Calibration" />
      <Panel>
        <Field label="Court profile name">
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            onChange={(event) => props.onDraftChange({ ...props.draftProfile, name: event.target.value })}
            value={props.draftProfile.name}
          />
        </Field>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(["hoop", "two", "three", "out"] as CalibrationTool[]).map((tool) => (
            <button
              className={clsx(
                "rounded-lg border px-2 py-2 text-xs font-black uppercase",
                props.selectedTool === tool
                  ? "border-teal-300 bg-teal-300 text-slate-950"
                  : "border-white/10 bg-white/5 text-slate-300",
              )}
              key={tool}
              onClick={() => props.onToolChange(tool)}
              type="button"
            >
              {tool}
            </button>
          ))}
        </div>
      </Panel>
      <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
        <CalibrationCanvas profile={props.draftProfile} onClick={props.onCanvasClick} />
      </div>
      <Panel>
        <div className="flex items-start gap-3">
          {props.validation.valid ? <Check className="size-5 text-emerald-300" /> : <ShieldAlert className="size-5 text-orange-300" />}
          <div className="min-w-0">
            <p className="text-sm font-black">{props.validation.valid ? "Profile is ready" : "Profile needs attention"}</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Tap the editor to place the hoop, 2PT area, 3PT area, or out-of-bounds polygon. Use the template when you need a quick test profile.
            </p>
            {[...props.validation.errors, ...props.validation.warnings].map((message) => (
              <p className="mt-2 text-xs font-semibold text-orange-100" key={message}>
                {message}
              </p>
            ))}
          </div>
        </div>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <ActionButton icon={Target} label="Template" onClick={() => props.onDraftChange(makeDefaultProfile(makeId("profile")))} />
        <PrimaryButton icon={Save} label="Save" onClick={props.onSave} />
        <ActionButton icon={Trash2} label="Delete" onClick={() => props.onDelete(props.draftProfile.id)} />
      </div>
    </div>
  );
}

function GameScreen(props: {
  session: GameSession;
  teams: CourtVisionTeam[];
  profile: CalibrationProfile | null;
  pendingShot: ShotEvent | null;
  cameraStatus: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRequestCamera: () => void;
  onShot: (params: { location: Point; result: ShotResult; teamId?: string; confidence?: number; source: "debug" | "manual" }) => void;
  onUndo: () => void;
  onCorrection: (shotId: string, patch: Partial<Pick<ShotEvent, "teamId" | "zone" | "result" | "points">>) => void;
  onHistory: () => void;
}) {
  const firstTeam = props.teams[0];
  const secondTeam = props.teams[1];
  const twoPoint = { x: 50, y: 50 };
  const threePoint = { x: 50, y: 82 };
  const unknownPoint = { x: 92, y: 52 };

  return (
    <div className="space-y-4">
      <Scoreboard session={props.session} />
      <CameraPreview videoRef={props.videoRef} profile={props.profile} active={props.cameraStatus === "ready"} />
      <div className="grid grid-cols-2 gap-2">
        <PrimaryButton icon={Camera} label="Camera" onClick={props.onRequestCamera} />
        <ActionButton icon={Undo2} label="Undo" onClick={props.onUndo} />
      </div>
      {props.pendingShot ? (
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-orange-100">Confirm last play</p>
              <p className="text-xs font-semibold text-slate-400">{props.pendingShot.confirmationReason?.replace("_", " ") ?? "needs review"}</p>
            </div>
            <span className="rounded-lg bg-orange-300 px-2 py-1 text-xs font-black text-slate-950">
              {Math.round(props.pendingShot.confidence * 100)}%
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {props.teams.map((team) => (
              <button
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-black"
                key={team.id}
                onClick={() =>
                  props.onCorrection(props.pendingShot?.id ?? "", {
                    teamId: team.id,
                    zone: props.pendingShot?.zone === "unknown" ? "two" : props.pendingShot?.zone,
                    result: "made",
                    points: props.pendingShot?.zone === "three" ? 3 : 2,
                  })
                }
                style={{ backgroundColor: team.colorHex }}
                type="button"
              >
                {team.name}
              </button>
            ))}
            <ActionButton icon={Target} label="Make 2" onClick={() => props.onCorrection(props.pendingShot?.id ?? "", { zone: "two", result: "made", points: 2, teamId: props.pendingShot?.teamId ?? firstTeam?.id })} />
            <ActionButton icon={Target} label="Make 3" onClick={() => props.onCorrection(props.pendingShot?.id ?? "", { zone: "three", result: "made", points: 3, teamId: props.pendingShot?.teamId ?? firstTeam?.id })} />
          </div>
        </Panel>
      ) : null}
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-black">Debug shot simulator</p>
          <span className="text-xs font-semibold text-slate-400">No CV required</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={Target} label="Blue 2PT" onClick={() => props.onShot({ location: twoPoint, result: "made", teamId: firstTeam?.id, confidence: 0.96, source: "debug" })} />
          <ActionButton icon={Target} label="Blue 3PT" onClick={() => props.onShot({ location: threePoint, result: "made", teamId: firstTeam?.id, confidence: 0.94, source: "debug" })} />
          <ActionButton icon={Target} label={(secondTeam?.name ?? "Team B") + " 2PT"} onClick={() => props.onShot({ location: twoPoint, result: "made", teamId: secondTeam?.id ?? firstTeam?.id, confidence: 0.95, source: "debug" })} />
          <ActionButton icon={Target} label="Miss" onClick={() => props.onShot({ location: twoPoint, result: "missed", teamId: firstTeam?.id, confidence: 0.98, source: "debug" })} />
          <ActionButton icon={ShieldAlert} label="Unknown Team" onClick={() => props.onShot({ location: twoPoint, result: "made", confidence: 0.93, source: "debug" })} />
          <ActionButton icon={ShieldAlert} label="Unknown Zone" onClick={() => props.onShot({ location: unknownPoint, result: "made", teamId: firstTeam?.id, confidence: 0.93, source: "debug" })} />
        </div>
      </Panel>
      <ShotLog shots={props.session.shots} teams={props.teams} />
    </div>
  );
}

function GameOverScreen(props: {
  session: GameSession;
  winnerTeam: CourtVisionTeam | null;
  onNewGame: () => void;
  onHistory: () => void;
  onExport: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange-300/35 bg-orange-400/15 p-5 text-center">
        <Trophy className="mx-auto size-12 text-orange-300" />
        <h1 className="mt-3 text-2xl font-black">{props.winnerTeam?.name ?? "Game Over"}</h1>
        <p className="mt-1 text-sm font-semibold text-orange-100">Winner</p>
      </div>
      <Scoreboard session={props.session} />
      <Panel>
        <p className="text-sm font-black">Stats summary</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Attempts" value={String(props.session.stats.totalAttempts)} />
          <Metric label="Makes" value={String(props.session.stats.totalMakes)} />
          <Metric label="Misses" value={String(props.session.stats.totalMisses)} />
        </div>
      </Panel>
      <ShotChart shots={props.session.shots} />
      <div className="grid grid-cols-3 gap-2">
        <PrimaryButton icon={Play} label="New" onClick={props.onNewGame} />
        <ActionButton icon={History} label="History" onClick={props.onHistory} />
        <ActionButton icon={Download} label="JSON" onClick={props.onExport} />
      </div>
    </div>
  );
}

function HistoryScreen(props: {
  sessions: GameSession[];
  onReplay: (session: GameSession) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={History} title="Session History" />
      {props.sessions.length === 0 ? (
        <Panel>
          <p className="text-sm font-semibold text-slate-300">No saved game sessions yet.</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {props.sessions.map((session) => (
            <button
              className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left"
              key={session.id}
              onClick={() => props.onReplay(session)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black">{session.teams.find((team) => team.id === session.winnerTeamId)?.name ?? "In-progress game"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{new Date(session.createdAt).toLocaleString()}</p>
                </div>
                <p className="text-lg font-black">
                  {session.teams.map((team) => session.scores[team.id] ?? 0).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      <ActionButton icon={Trash2} label="Clear History" onClick={props.onClear} />
    </div>
  );
}

function Scoreboard({ session }: { session: GameSession }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${session.teams.length}, minmax(0, 1fr))` }}>
        {session.teams.map((team) => {
          const stats = session.stats.teamStats[team.id];
          const attempts = stats?.attempts ?? 0;
          const pct = attempts > 0 ? Math.round(((stats?.makes ?? 0) / attempts) * 100) : 0;
          return (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3" key={team.id}>
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ backgroundColor: team.colorHex }} />
                <p className="truncate text-xs font-black uppercase text-slate-300">{team.name}</p>
              </div>
              <p className="mt-2 text-5xl font-black leading-none">{session.scores[team.id] ?? 0}</p>
              <p className="mt-2 text-xs font-semibold text-slate-400">
                {stats?.makes ?? 0}/{attempts} FG · {pct}%
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold text-slate-400">
        <span>Target {session.rules.targetScore}{session.rules.winByTwo ? " · win by 2" : ""}</span>
        {session.rules.shotClockSeconds ? <span>{session.rules.shotClockSeconds}s clock</span> : <span>No shot clock</span>}
      </div>
    </div>
  );
}

function CameraPreview({ videoRef, profile, active }: { videoRef: React.RefObject<HTMLVideoElement | null>; profile: CalibrationProfile | null; active: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-950">
      <div className="aspect-[4/3]">
        <video
          className={clsx("h-full w-full object-cover", active ? "block" : "hidden")}
          muted
          playsInline
          ref={videoRef}
        />
        {!active ? (
          <div className="grid h-full place-items-center court-line-bg">
            <div className="text-center">
              <Camera className="mx-auto size-10 text-slate-500" />
              <p className="mt-3 text-sm font-black text-slate-300">Camera preview</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Debug mode works without permission</p>
            </div>
          </div>
        ) : null}
      </div>
      {profile ? <Overlay profile={profile} /> : null}
    </div>
  );
}

function CalibrationCanvas({ profile, onClick }: { profile: CalibrationProfile; onClick: (event: React.MouseEvent<SVGSVGElement>) => void }) {
  return (
    <svg
      className="aspect-[4/3] w-full rounded-lg bg-[#111827]"
      onClick={onClick}
      role="img"
      viewBox="0 0 100 100"
    >
      <rect fill="rgba(249,115,22,0.06)" height="100" width="100" />
      <path d="M8 12H92V92H8Z" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
      <OverlaySvg profile={profile} />
      <text fill="rgba(255,255,255,0.55)" fontSize="4" x="5" y="8">
        tap to edit selected tool
      </text>
    </svg>
  );
}

function Overlay({ profile }: { profile: CalibrationProfile }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      <OverlaySvg profile={profile} />
    </svg>
  );
}

function OverlaySvg({ profile }: { profile: CalibrationProfile }) {
  return (
    <>
      {profile.threePointZones.map((zone) => (
        <Polygon key={zone.id} points={zone.polygon} fill="rgba(45,212,191,0.12)" stroke="#2dd4bf" />
      ))}
      {profile.twoPointZones.map((zone) => (
        <Polygon key={zone.id} points={zone.polygon} fill="rgba(249,115,22,0.13)" stroke="#fb923c" />
      ))}
      {profile.outOfBoundsZones.map((zone) => (
        <Polygon key={zone.id} points={zone.polygon} fill="rgba(248,113,113,0.12)" stroke="#f87171" />
      ))}
      {profile.hoopRegion ? (
        <>
          <rect
            fill="rgba(255,255,255,0.08)"
            height={profile.hoopRegion.bounds.height}
            stroke="#facc15"
            strokeWidth="1"
            width={profile.hoopRegion.bounds.width}
            x={profile.hoopRegion.bounds.x}
            y={profile.hoopRegion.bounds.y}
          />
          {profile.hoopRegion.rimCenter ? (
            <circle cx={profile.hoopRegion.rimCenter.x} cy={profile.hoopRegion.rimCenter.y} fill="#facc15" r="1.8" />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Polygon({ points, fill, stroke }: { points: Point[]; fill: string; stroke: string }) {
  return (
    <>
      <polygon fill={fill} points={points.map((point) => `${point.x},${point.y}`).join(" ")} stroke={stroke} strokeWidth="1" />
      {points.map((point, index) => (
        <circle cx={point.x} cy={point.y} fill={stroke} key={`${point.x}-${point.y}-${index}`} r="1.1" />
      ))}
    </>
  );
}

function ShotLog({ shots, teams }: { shots: ShotEvent[]; teams: CourtVisionTeam[] }) {
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black">Shot log</p>
        <span className="text-xs font-semibold text-slate-400">{shots.length} plays</span>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {shots.length === 0 ? <p className="text-sm font-semibold text-slate-400">No shot events yet.</p> : null}
        {shots.slice().reverse().map((shot) => {
          const team = teams.find((item) => item.id === shot.teamId);
          return (
            <div className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" key={shot.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black">
                  {team?.name ?? "Unassigned"} · {shot.result} · {shot.zone.toUpperCase()}
                </p>
                <span className="text-sm font-black text-orange-300">+{shot.points}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {shot.source.toUpperCase()} · confidence {Math.round(shot.confidence * 100)}%
                {shot.needsConfirmation ? " · needs confirmation" : ""}
              </p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ShotChart({ shots }: { shots: ShotEvent[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
      <svg className="aspect-[4/3] w-full" viewBox="0 0 100 100">
        <rect fill="#0f172a" height="100" width="100" />
        <path d="M8 12H92V92H8Z" fill="none" stroke="rgba(255,255,255,0.2)" />
        {shots.map((shot) => (
          <circle
            cx={shot.shotLocation.x}
            cy={shot.shotLocation.y}
            fill={shot.result === "made" ? "#22c55e" : "#f43f5e"}
            key={shot.id}
            r={shot.zone === "three" ? 2.3 : 1.8}
          />
        ))}
      </svg>
    </div>
  );
}

function BottomNav({ active, onNavigate, hasSession }: { active: Screen; onNavigate: (screen: Screen) => void; hasSession: boolean }) {
  const items: Array<{ screen: Screen; label: string; icon: React.ComponentType<{ className?: string }>; enabled: boolean }> = [
    { screen: "home", label: "Home", icon: Home, enabled: true },
    { screen: "setup", label: "Setup", icon: Settings, enabled: true },
    { screen: "calibration", label: "Calibrate", icon: Layers3, enabled: true },
    { screen: "game", label: "Game", icon: Activity, enabled: hasSession },
    { screen: "history", label: "History", icon: History, enabled: true },
  ];
  return (
    <nav className="safe-bottom sticky bottom-0 z-30 grid grid-cols-5 border-t border-white/10 bg-[#091522]/95 px-2 pt-2 backdrop-blur">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={clsx(
              "rounded-lg px-1 py-2 text-[0.68rem] font-black",
              active === item.screen ? "bg-orange-400 text-slate-950" : "text-slate-400",
              !item.enabled && "opacity-40",
            )}
            disabled={!item.enabled}
            key={item.screen}
            onClick={() => onNavigate(item.screen)}
            type="button"
          >
            <Icon className="mx-auto mb-1 size-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">{children}</div>;
}

function SectionTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-5 text-orange-300" />
      <h1 className="text-lg font-black">{title}</h1>
    </div>
  );
}

function PrimaryButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-orange-400 px-3 py-2 text-sm font-black text-slate-950"
      onClick={onClick}
      type="button"
    >
      <Icon className="size-4" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-black text-slate-100"
      onClick={onClick}
      type="button"
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-slate-950 px-3 py-2">
      <span className="text-sm font-bold text-slate-200">{label}</span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-black uppercase text-slate-400">{children}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/85 p-2">
      <p className="text-[0.66rem] font-black uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const ready = status === "ready";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black", ready ? "bg-emerald-300 text-slate-950" : "bg-white/10 text-slate-300")}>
      <Camera className="size-3" />
      {ready ? "Camera" : "Debug"}
    </span>
  );
}

function editProfileAtPoint(profile: CalibrationProfile, tool: CalibrationTool, point: Point): CalibrationProfile {
  if (tool === "hoop") {
    return {
      ...profile,
      hoopRegion: {
        id: "hoop",
        label: "Hoop",
        bounds: {
          x: Math.max(0, point.x - 8),
          y: Math.max(0, point.y - 5),
          width: 16,
          height: 10,
        },
        rimCenter: point,
      },
    };
  }

  const key = tool === "two" ? "twoPointZones" : tool === "three" ? "threePointZones" : "outOfBoundsZones";
  const kind = tool === "three" ? "three" : "two";
  const existing = profile[key][0];
  const nextZone: ScoringZone = existing
    ? { ...existing, polygon: [...existing.polygon, point].slice(-8) }
    : { id: makeId(`${tool}-zone`), label: `${tool.toUpperCase()} zone`, kind, polygon: [point] };

  return {
    ...profile,
    [key]: existing ? profile[key].map((zone, index) => (index === 0 ? nextZone : zone)) : [nextZone],
  };
}

function makeDefaultProfile(id = "profile-default"): CalibrationProfile {
  const now = Date.now();
  return {
    id,
    name: "Default half court",
    createdAt: now,
    updatedAt: now,
    cameraOrientation: "portrait",
    previewSize: PREVIEW_SIZE,
    hoopRegion: {
      id: "hoop",
      label: "Main hoop",
      bounds: { x: 42, y: 8, width: 16, height: 10 },
      rimCenter: { x: 50, y: 14 },
    },
    twoPointZones: [
      {
        id: "two-zone",
        label: "2PT area",
        kind: "two",
        polygon: [
          { x: 24, y: 18 },
          { x: 76, y: 18 },
          { x: 74, y: 69 },
          { x: 26, y: 69 },
        ],
      },
    ],
    threePointZones: [
      {
        id: "three-zone",
        label: "3PT area",
        kind: "three",
        polygon: [
          { x: 8, y: 70 },
          { x: 92, y: 70 },
          { x: 96, y: 96 },
          { x: 4, y: 96 },
        ],
      },
    ],
    outOfBoundsZones: [],
  };
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function playBuzzer() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(220, context.currentTime);
    oscillator.frequency.setValueAtTime(160, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.72);
  } catch {
    return;
  }
}

function downloadJson(session: GameSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${session.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function findLatestPendingShot(shots: ShotEvent[]): ShotEvent | null {
  for (let index = shots.length - 1; index >= 0; index -= 1) {
    const shot = shots[index];
    if (shot?.needsConfirmation) return shot;
  }
  return null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
