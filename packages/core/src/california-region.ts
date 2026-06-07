export type CaliforniaTournamentRegion =
  | "Northern California"
  | "Southern California";

const BAKERSFIELD_CUTOFF_LATITUDE = 35.3733;

const CALIFORNIA_CITY_LATITUDES: Record<string, number> = {
  alameda: 37.7652,
  anaheim: 33.8366,
  "apple valley": 34.5008,
  arcadia: 34.1397,
  acton: 34.4705,
  "agoura hills": 34.1533,
  bakersfield: BAKERSFIELD_CUTOFF_LATITUDE,
  berkeley: 37.8715,
  burbank: 34.1808,
  calabasas: 34.1367,
  carson: 33.8317,
  carlsbad: 33.1581,
  chatsworth: 34.2506,
  chino: 34.0122,
  "chino hills": 33.9898,
  "chula vista": 32.6401,
  clovis: 36.8252,
  compton: 33.8958,
  concord: 37.978,
  corona: 33.8753,
  "costa mesa": 33.6411,
  covina: 34.09,
  "culver city": 34.0211,
  cupertino: 37.3229,
  danville: 37.8216,
  downey: 33.94,
  "el cajon": 32.7948,
  "el segundo": 33.9192,
  "elk grove": 38.4088,
  encinitas: 33.03699,
  encino: 34.1517,
  escondido: 33.1192,
  eastvale: 33.9525,
  fontana: 34.0922,
  fremont: 37.5485,
  fresno: 36.7378,
  fullerton: 33.8704,
  "garden grove": 33.7743,
  gardena: 33.8883,
  gilroy: 37.0058,
  glendale: 34.1425,
  glendora: 34.1361,
  hanford: 36.3275,
  hayward: 37.6688,
  hemet: 33.7475,
  hesperia: 34.4264,
  "hermosa beach": 33.8622,
  "huntington beach": 33.6603,
  indio: 33.7206,
  inglewood: 33.9617,
  irvine: 33.6846,
  "la jolla": 32.8328,
  "la mesa": 32.7678,
  lancaster: 34.6868,
  "ladera ranch": 33.5709,
  "lake forest": 33.6469,
  lakewood: 33.8536,
  "la mirada": 33.9172,
  "la verne": 34.1008,
  livermore: 37.6819,
  "long beach": 33.7701,
  "los angeles": 34.0522,
  lynwood: 33.9303,
  madera: 36.9613,
  malibu: 34.0259,
  "manhattan beach": 33.8847,
  merced: 37.3022,
  menifee: 33.6971,
  "mission hills": 34.2572,
  milpitas: 37.4323,
  "mira loma": 33.9925,
  modesto: 37.6391,
  "moreno valley": 33.9425,
  murrieta: 33.5539,
  napa: 38.2975,
  "national city": 32.6781,
  "newbury park": 34.1842,
  "newport beach": 33.6189,
  norco: 33.9311,
  northridge: 34.2381,
  oakland: 37.8044,
  oceanside: 33.1959,
  "ogp ladera": 33.5709,
  ontartio: 34.0633,
  ontario: 34.0633,
  orange: 33.7879,
  "orange county": 33.7175,
  oxnard: 34.1975,
  palmdale: 34.5794,
  "palm desert": 33.7222,
  "palm springs": 33.8303,
  pasadena: 34.1478,
  perris: 33.7825,
  "pismo beach": 35.1428,
  pomona: 34.0551,
  poway: 32.9628,
  "rancho cucamonga": 34.1064,
  redding: 40.5865,
  "redondo beach": 33.8492,
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
  "san marcos": 33.1434,
  "san mateo": 37.563,
  "san pedro": 33.7361,
  "san ramon": 37.7799,
  "santa ana": 33.7455,
  "santa barbara": 34.4208,
  "santa clara": 37.3541,
  "santa clarita": 34.3917,
  "santa cruz": 36.9741,
  "santa monica": 34.0195,
  "santa rosa": 38.4404,
  santee: 32.8384,
  "seal beach": 33.7414,
  "simi valley": 34.2694,
  stockton: 37.9577,
  sunnyvale: 37.3688,
  sylmar: 34.3058,
  temecula: 33.4936,
  "thousand oaks": 34.1706,
  torrance: 33.8358,
  tracy: 37.7397,
  tulare: 36.2077,
  vallejo: 38.1041,
  ventura: 34.2746,
  victorville: 34.5362,
  visalia: 36.3302,
  vista: 33.2000,
  "walnut creek": 37.9101,
  "west hills": 34.1973,
  westminster: 33.7513,
  "west covina": 34.0686,
  whittier: 33.9792,
  wilmington: 33.78,
  yucaipa: 34.0336,
};

export function californiaTournamentRegionFromPlace(
  value: string | null | undefined,
): CaliforniaTournamentRegion {
  const place = normalizeCaliforniaPlace(value);
  if (!place) return "Northern California";

  for (const [city, latitude] of CALIFORNIA_CITY_ENTRIES) {
    if (placeHasCity(place, city)) {
      return latitude < BAKERSFIELD_CUTOFF_LATITUDE
        ? "Southern California"
        : "Northern California";
    }
  }

  if (/\bsouthern california\b|\bsocal\b/.test(place))
    return "Southern California";
  if (/\bnorthern california\b|\bnorcal\b|\bbay area\b/.test(place))
    return "Northern California";

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
