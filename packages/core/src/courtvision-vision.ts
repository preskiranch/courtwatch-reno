import type {
  CalibrationProfile,
  CourtVisionTeam,
  HoopRegion,
  Point,
  ShotEvent,
  TeamClassificationResult,
} from "./courtvision-types.js";

export interface CameraFrame {
  id: string;
  timestamp: number;
  width: number;
  height: number;
  data?: unknown;
}

export interface CameraFrameProvider {
  start(onFrame: (frame: CameraFrame) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface CourtCalibrationService {
  listProfiles(): Promise<CalibrationProfile[]>;
  saveProfile(profile: CalibrationProfile): Promise<CalibrationProfile>;
  deleteProfile(profileId: string): Promise<void>;
  getProfile(profileId: string): Promise<CalibrationProfile | null>;
  validateProfile(profile: CalibrationProfile): { valid: boolean; errors: string[] };
}

export interface HoopDetector {
  detectHoop(frame: CameraFrame): Promise<{ hoopRegion?: HoopRegion; confidence: number }>;
}

export interface BallTracker {
  trackBall(frame: CameraFrame): Promise<{ location?: Point; confidence: number }>;
}

export interface PlayerTracker {
  trackPlayers(frame: CameraFrame): Promise<
    Array<{ id: string; center: Point; sampleColorHex?: string; confidence: number }>
  >;
}

export interface TeamColorClassifier {
  classify(sampleColorHex: string, teams: CourtVisionTeam[]): TeamClassificationResult;
}

export interface ShotAttemptDetector {
  detectShotAttempt(
    frames: CameraFrame[],
  ): Promise<{ releaseLocation?: Point; confidence: number }>;
}

export interface MadeShotDetector {
  detectMadeShot(
    frames: CameraFrame[],
    hoopRegion: HoopRegion,
  ): Promise<{ made: boolean | null; confidence: number }>;
}

export interface ShotScoringEngine {
  scoreDetectedShot(event: ShotEvent): ShotEvent;
}

export class NullCameraFrameProvider implements CameraFrameProvider {
  async start(): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }
}

export class PlaceholderHoopDetector implements HoopDetector {
  async detectHoop(): Promise<{ confidence: number }> {
    return { confidence: 0 };
  }
}

export class PlaceholderBallTracker implements BallTracker {
  async trackBall(): Promise<{ confidence: number }> {
    return { confidence: 0 };
  }
}

