import type { TournamentEvent } from "@courtwatch/core";
import { DEFAULT_TOURNAMENT_TIME_ZONE } from "./date-labels";
import type { FollowedFinalResultGroup } from "./final-result-groups";

export type FinalResultShareRow = {
  label: string;
  teamName: string;
  recordText: string;
  placement: number;
  note?: string;
};

export async function renderFinalResultShareImage({
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

export function finalResultShareFilename(
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
