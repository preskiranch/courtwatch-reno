export const MAX_TRUSTED_BASKETBALL_SCORE = 199;

export function sanitizeBasketballScore(score: number | null): number | null {
  if (score === null || !Number.isFinite(score) || score < 0) return null;
  const wholeScore = Math.trunc(score);
  if (wholeScore <= MAX_TRUSTED_BASKETBALL_SCORE) return wholeScore;

  const text = String(wholeScore);
  if (text.length === 3) {
    const likelyScore = Number(text.slice(0, 2));
    if (Number.isFinite(likelyScore) && likelyScore >= 0) return likelyScore;
  }

  return null;
}
