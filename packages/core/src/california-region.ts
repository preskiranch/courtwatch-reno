export type CaliforniaTournamentRegion =
  | "Northern California"
  | "Southern California";

const BAKERSFIELD_CUTOFF_LATITUDE = 35.3733;

const CALIFORNIA_CITY_LATITUDES: Record<string, number> = {
  alameda: 37.7652,
  anaheim: 33.8366,
  "apple valley": 34.5008,
  arcadia: 34.1397,
  bakersfield: BAKERSFIELD_CUTOFF_LATITUDE,
  berkeley: 37.8715,
  burbank: 34.1808,
  carlsbad: 33.1581,
  "chula vista": 32.6401,
  clovis: 36.8252,
  concord: 37.978,
  corona: 33.8753,
  "costa mesa": 33.6411,
  "culver city": 34.0211,
  cupertino: 37.3229,
  danville: 37.8216,
  "el segundo": 33.9192,
  "elk grove": 38.4088,
  fontana: 34.0922,
  fremont: 37.5485,
  fresno: 36.7378,
  fullerton: 33.8704,
  "garden grove": 33.7743,
  gilroy: 37.0058,
  glendale: 34.1425,
  hanford: 36.3275,
  hayward: 37.6688,
  hesperia: 34.4264,
  "huntington beach": 33.6603,
  indio: 33.7206,
  inglewood: 33.9617,
  irvine: 33.6846,
  lancaster: 34.6868,
  "la mirada": 33.9172,
  livermore: 37.6819,
  "long beach": 33.7701,
  "los angeles": 34.0522,
  madera: 36.9613,
  merced: 37.3022,
  milpitas: 37.4323,
  modesto: 37.6391,
  "moreno valley": 33.9425,
  murrieta: 33.5539,
  napa: 38.2975,
  "newport beach": 33.6189,
  oakland: 37.8044,
  oceanside: 33.1959,
  ontario: 34.0633,
  orange: 33.7879,
  "orange county": 33.7175,
  oxnard: 34.1975,
  palmdale: 34.5794,
  "palm desert": 33.7222,
  "palm springs": 33.8303,
  pasadena: 34.1478,
  "rancho cucamonga": 34.1064,
  redding: 40.5865,
  richmond: 37.9358,
  riverside: 33.9806,
  roseville: 38.7521,
  sacramento: 38.5816,
  salinas: 36.6777,
  "san bernardino": 34.1083,
  "san clemente": 33.4269,
  "san diego": 32.7157,
  "san francisco": 37.7749,
  "san jose": 37.3382,
  "san leandro": 37.7258,
  "san mateo": 37.563,
  "san ramon": 37.7799,
  "santa ana": 33.7455,
  "santa clara": 37.3541,
  "santa clarita": 34.3917,
  "santa cruz": 36.9741,
  "santa rosa": 38.4404,
  "simi valley": 34.2694,
  stockton: 37.9577,
  sunnyvale: 37.3688,
  temecula: 33.4936,
  "thousand oaks": 34.1706,
  torrance: 33.8358,
  tracy: 37.7397,
  tulare: 36.2077,
  vallejo: 38.1041,
  ventura: 34.2746,
  victorville: 34.5362,
  visalia: 36.3302,
  "walnut creek": 37.9101,
  westminster: 33.7513,
  "west covina": 34.0686,
};

export function californiaTournamentRegionFromPlace(
  value: string | null | undefined,
): CaliforniaTournamentRegion {
  const place = normalizeCaliforniaPlace(value);
  if (!place) return "Northern California";
  if (/\bsouthern california\b|\bsocal\b/.test(place))
    return "Southern California";
  if (/\bnorthern california\b|\bnorcal\b|\bbay area\b/.test(place))
    return "Northern California";

  for (const [city, latitude] of CALIFORNIA_CITY_ENTRIES) {
    if (placeHasCity(place, city)) {
      return latitude < BAKERSFIELD_CUTOFF_LATITUDE
        ? "Southern California"
        : "Northern California";
    }
  }

  return "Northern California";
}

export function isSouthernCaliforniaPlace(
  value: string | null | undefined,
): boolean {
  return californiaTournamentRegionFromPlace(value) === "Southern California";
}

function normalizeCaliforniaPlace(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeHasCity(place: string, city: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(city)}(\\s|$)`).test(place);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CALIFORNIA_CITY_ENTRIES = Object.entries(CALIFORNIA_CITY_LATITUDES).sort(
  ([left], [right]) => right.length - left.length,
);
