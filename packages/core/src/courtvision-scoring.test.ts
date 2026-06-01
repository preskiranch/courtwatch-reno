import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  scoringZoneForPoint,
  validateCalibrationProfile,
} from "./courtvision-calibration.js";
import {
  applyShotEvent,
  buildShotEvent,
  classifyTeamByColor,
  correctShotEvent,
  createInitialGameSession,
  defaultCourtVisionRules,
  defaultCourtVisionTeams,
  hasWon,
  undoLastShot,
} from "./courtvision-scoring.js";
import type {
  CalibrationProfile,
  GameRules,
  ShotEvent,
} from "./courtvision-types.js";

const profile: CalibrationProfile = {
  id: "profile-home",
  name: "Home Court",
  createdAt: 1,
  updatedAt: 1,
  cameraOrientation: "portrait",
  previewSize: { width: 100, height: 100 },
  hoopRegion: {
    id: "hoop",
    label: "Main hoop",
    bounds: { x: 42, y: 4, width: 16, height: 12 },
    rimCenter: { x: 50, y: 10 },
  },
  twoPointZones: [
    {
      id: "paint",
      label: "2PT",
      kind: "two",
      polygon: [
        { x: 25, y: 20 },
        { x: 75, y: 20 },
        { x: 75, y: 70 },
        { x: 25, y: 70 },
      ],
    },
  ],
  threePointZones: [
    {
      id: "arc",
      label: "3PT",
      kind: "three",
      polygon: [
        { x: 5, y: 72 },
        { x: 95, y: 72 },
        { x: 95, y: 98 },
        { x: 5, y: 98 },
      ],
    },
  ],
  outOfBoundsZones: [
    {
      id: "bleachers",
      label: "Out",
      kind: "two",
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 100 },
        { x: 0, y: 100 },
      ],
    },
  ],
};

function rules(overrides: Partial<GameRules> = {}): GameRules {
  return {
    ...defaultCourtVisionRules("two_team"),
    ...overrides,
  };
}

function shot(overrides: Partial<ShotEvent> = {}): ShotEvent {
  return {
    id: "shot-1",
    timestamp: 10,
    teamId: "team-blue",
    shotLocation: { x: 50, y: 50 },
    zone: "two",
    result: "made",
    points: 2,
    confidence: 0.95,
    source: "debug",
    ...overrides,
  };
}

describe("CourtVision calibration geometry", () => {
  it("detects points inside, outside, and on polygon edges", () => {
    const square = profile.twoPointZones[0]?.polygon ?? [];

    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 90, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 25, y: 40 }, square)).toBe(true);
  });

  it("detects shot scoring zones and respects out-of-bounds polygons", () => {
    expect(scoringZoneForPoint({ x: 50, y: 50 }, profile)).toBe("two");
    expect(scoringZoneForPoint({ x: 50, y: 80 }, profile)).toBe("three");
    expect(scoringZoneForPoint({ x: 3, y: 80 }, profile)).toBe("unknown");
    expect(scoringZoneForPoint({ x: 90, y: 50 }, profile)).toBe("unknown");
  });

  it("validates required calibration profile data", () => {
    expect(validateCalibrationProfile(profile).valid).toBe(true);

    const invalid = {
      ...profile,
      name: "",
      hoopRegion: undefined,
      twoPointZones: [],
      threePointZones: [],
    };
    const result = validateCalibrationProfile(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Court profile name is required.");
    expect(result.errors).toContain("Hoop or rim region is required.");
    expect(result.errors).toContain("At least one scoring zone is required.");
  });
});

describe("CourtVision scoring engine", () => {
  it("calculates a simulated 2-point made shot", () => {
    const event = buildShotEvent(
      {
        teamId: "team-blue",
        shotLocation: { x: 50, y: 50 },
        result: "made",
        confidence: 0.93,
        source: "debug",
        timestamp: 100,
      },
      profile,
      rules(),
    );

    expect(event.zone).toBe("two");
    expect(event.points).toBe(2);
    expect(event.needsConfirmation).toBe(false);
  });

  it("calculates a simulated 3-point made shot", () => {
    const event = buildShotEvent(
      {
        teamId: "team-red",
        shotLocation: { x: 50, y: 80 },
        result: "made",
        confidence: 0.91,
        source: "debug",
      },
      profile,
      rules(),
    );

    expect(event.zone).toBe("three");
    expect(event.points).toBe(3);
  });

  it("keeps missed shots at zero points", () => {
    const event = buildShotEvent(
      {
        teamId: "team-blue",
        shotLocation: { x: 50, y: 80 },
        result: "missed",
        confidence: 0.99,
        source: "manual",
      },
      profile,
      rules(),
    );

    expect(event.points).toBe(0);
    expect(event.needsConfirmation).toBe(false);
  });

  it("requires confirmation for unknown team in team mode", () => {
    const event = buildShotEvent(
      {
        shotLocation: { x: 50, y: 50 },
        result: "made",
        confidence: 0.99,
        source: "ai",
      },
      profile,
      rules(),
    );

    expect(event.points).toBe(0);
    expect(event.needsConfirmation).toBe(true);
    expect(event.confirmationReason).toBe("unknown_team");
  });

  it("requires confirmation for unknown zone", () => {
    const event = buildShotEvent(
      {
        teamId: "team-blue",
        shotLocation: { x: 90, y: 50 },
        result: "made",
        confidence: 0.99,
        source: "ai",
      },
      profile,
      rules(),
    );

    expect(event.points).toBe(0);
    expect(event.needsConfirmation).toBe(true);
    expect(event.confirmationReason).toBe("unknown_zone");
  });

  it("updates scores and can undo the last event", () => {
    const session = createInitialGameSession({
      id: "game-1",
      rules: rules({ targetScore: 11 }),
      teams: defaultCourtVisionTeams(),
      calibrationProfileId: profile.id,
    });

    const scored = applyShotEvent(session, shot());

    expect(scored.scores["team-blue"]).toBe(2);
    expect(scored.stats.teamStats["team-blue"]?.twoPointMakes).toBe(1);

    const undone = undoLastShot(scored);

    expect(undone.scores["team-blue"]).toBe(0);
    expect(undone.shots).toHaveLength(0);
  });

  it("respects target score and win condition", () => {
    const session = createInitialGameSession({
      id: "game-2",
      rules: rules({ targetScore: 4, winByTwo: false }),
      teams: defaultCourtVisionTeams(),
    });
    const first = applyShotEvent(session, shot({ id: "shot-1", points: 2 }));
    const winner = applyShotEvent(first, shot({ id: "shot-2", points: 2 }));

    expect(hasWon(winner.scores, "team-blue", winner.rules)).toBe(true);
    expect(winner.winnerTeamId).toBe("team-blue");
    expect(winner.buzzerTriggered).toBe(true);
  });

  it("requires a two-point lead when win-by-2 is enabled", () => {
    const base = createInitialGameSession({
      id: "game-3",
      rules: rules({ targetScore: 4, winByTwo: true }),
      teams: defaultCourtVisionTeams(),
    });
    const tied = {
      ...base,
      scores: { "team-blue": 4, "team-red": 3 },
    };

    expect(hasWon(tied.scores, "team-blue", tied.rules)).toBe(false);
    expect(hasWon({ "team-blue": 5, "team-red": 3 }, "team-blue", tied.rules)).toBe(
      true,
    );
  });

  it("allows manual correction from 2 to 3 points", () => {
    const session = applyShotEvent(
      createInitialGameSession({
        id: "game-4",
        rules: rules(),
        teams: defaultCourtVisionTeams(),
      }),
      shot(),
    );

    const corrected = correctShotEvent(session, "shot-1", {
      zone: "three",
      points: 3,
      result: "made",
      teamId: "team-blue",
    });

    expect(corrected.scores["team-blue"]).toBe(3);
    expect(corrected.shots[0]?.zone).toBe("three");
  });

  it("flags low-confidence team color classification for fallback confirmation", () => {
    const clearBlue = classifyTeamByColor({
      sampledHex: "#2457d7",
      teams: defaultCourtVisionTeams(),
    });
    const unclear = classifyTeamByColor({
      sampledHex: "#777777",
      teams: defaultCourtVisionTeams(),
    });

    expect(clearBlue.teamId).toBe("team-blue");
    expect(clearBlue.needsConfirmation).toBe(false);
    expect(unclear.needsConfirmation).toBe(true);
  });
});
