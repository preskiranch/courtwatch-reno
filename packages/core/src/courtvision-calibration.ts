import type {
  CalibrationProfile,
  Point,
  ScoringZone,
  ScoringZoneKind,
} from "./courtvision-types.js";

const MIN_POLYGON_POINTS = 3;

export interface CalibrationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < MIN_POLYGON_POINTS) return false;

  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (!current || !previous) continue;

    if (pointOnSegment(point, previous, current)) {
      return true;
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

export function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.000001) return false;

  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;

  const squaredLength =
    (end.x - start.x) * (end.x - start.x) +
    (end.y - start.y) * (end.y - start.y);
  return dot <= squaredLength;
}

export function scoringZoneForPoint(
  point: Point,
  profile: CalibrationProfile,
): ScoringZoneKind {
  if (isOutOfBounds(point, profile)) return "unknown";
  if (profile.threePointZones.some((zone) => pointInPolygon(point, zone.polygon))) {
    return "three";
  }
  if (profile.twoPointZones.some((zone) => pointInPolygon(point, zone.polygon))) {
    return "two";
  }
  return "unknown";
}

export function matchingScoringZone(
  point: Point,
  profile: CalibrationProfile,
): ScoringZone | null {
  if (isOutOfBounds(point, profile)) return null;
  return (
    profile.threePointZones.find((zone) => pointInPolygon(point, zone.polygon)) ??
    profile.twoPointZones.find((zone) => pointInPolygon(point, zone.polygon)) ??
    null
  );
}

export function isOutOfBounds(point: Point, profile: CalibrationProfile): boolean {
  return profile.outOfBoundsZones.some((zone) => pointInPolygon(point, zone.polygon));
}

export function validateCalibrationProfile(
  profile: CalibrationProfile,
): CalibrationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profile.name.trim()) errors.push("Court profile name is required.");
  if (profile.previewSize.width <= 0 || profile.previewSize.height <= 0) {
    errors.push("Preview dimensions must be greater than zero.");
  }
  if (!profile.hoopRegion) {
    errors.push("Hoop or rim region is required.");
  } else if (
    profile.hoopRegion.bounds.width <= 0 ||
    profile.hoopRegion.bounds.height <= 0
  ) {
    errors.push("Hoop region must have a valid size.");
  }

  const scoringZones = [...profile.twoPointZones, ...profile.threePointZones];
  if (scoringZones.length === 0) {
    errors.push("At least one scoring zone is required.");
  }

  for (const zone of [...scoringZones, ...profile.outOfBoundsZones]) {
    if (zone.polygon.length < MIN_POLYGON_POINTS) {
      errors.push(`${zone.label} needs at least ${MIN_POLYGON_POINTS} points.`);
    }
    if (!zone.polygon.every((point) => pointWithinPreview(point, profile))) {
      warnings.push(`${zone.label} has points outside the preview frame.`);
    }
  }

  if (profile.twoPointZones.length === 0) {
    warnings.push("No 2-point zone is defined.");
  }
  if (profile.threePointZones.length === 0) {
    warnings.push("No 3-point zone is defined.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function pointWithinPreview(point: Point, profile: CalibrationProfile): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= profile.previewSize.width &&
    point.y <= profile.previewSize.height
  );
}

