export type CourtVisionMode = "solo" | "one_team" | "two_team";
export type ScoringZoneKind = "two" | "three" | "unknown";
export type ShotResult = "made" | "missed" | "unknown";
export type ShotSource = "ai" | "manual" | "debug";
export type CameraOrientation = "portrait" | "landscape";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HoopRegion {
  id: string;
  label: string;
  bounds: BoundingBox;
  polygon?: Point[];
  rimCenter?: Point;
}

export interface ScoringZone {
  id: string;
  label: string;
  kind: Exclude<ScoringZoneKind, "unknown">;
  polygon: Point[];
}

export interface CalibrationProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cameraOrientation: CameraOrientation;
  previewSize: Size;
  hoopRegion?: HoopRegion;
  twoPointZones: ScoringZone[];
  threePointZones: ScoringZone[];
  outOfBoundsZones: ScoringZone[];
}

export interface CourtVisionTeam {
  id: string;
  name: string;
  colorName: string;
  colorHex: string;
}

export interface CourtVisionPlayer {
  id: string;
  teamId?: string;
  name: string;
  jerseyNumber?: string;
}

export interface GameRules {
  mode: CourtVisionMode;
  targetScore: number;
  winByTwo: boolean;
  twoPointersEnabled: boolean;
  threePointersEnabled: boolean;
  shotClockSeconds?: number;
  buzzerEnabled: boolean;
}

export interface ShotEvent {
  id: string;
  timestamp: number;
  teamId?: string;
  playerId?: string;
  shotLocation: Point;
  zone: ScoringZoneKind;
  result: ShotResult;
  points: 0 | 2 | 3;
  confidence: number;
  source: ShotSource;
  needsConfirmation?: boolean;
  confirmationReason?: "unknown_team" | "unknown_zone" | "unknown_result" | "low_confidence";
}

export interface TeamShotStats {
  attempts: number;
  makes: number;
  misses: number;
  twoPointAttempts: number;
  twoPointMakes: number;
  threePointAttempts: number;
  threePointMakes: number;
  points: number;
  currentStreak: number;
  bestRun: number;
}

export interface GameStats {
  teamStats: Record<string, TeamShotStats>;
  totalAttempts: number;
  totalMakes: number;
  totalMisses: number;
  shotChart: ShotEvent[];
}

export interface GameSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  mode: CourtVisionMode;
  rules: GameRules;
  teams: CourtVisionTeam[];
  calibrationProfileId?: string;
  shots: ShotEvent[];
  stats: GameStats;
  scores: Record<string, number>;
  winnerTeamId?: string;
  endedAt?: number;
  buzzerTriggered: boolean;
}

export interface ShotScoringInput {
  teamId?: string;
  playerId?: string;
  shotLocation: Point;
  result: ShotResult;
  confidence: number;
  source: ShotSource;
  timestamp?: number;
}

export interface TeamClassificationResult {
  teamId?: string;
  confidence: number;
  needsConfirmation: boolean;
}

