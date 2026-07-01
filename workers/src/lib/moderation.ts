/**
 * moderation.ts — content moderation / IP pre-approval for user-uploaded
 * designs, ported 1:1 from moderation.py.
 *
 * Gelato (and every POD) rejects copyrighted, trademarked, celebrity and
 * movie/brand artwork — and will suspend the account if we keep submitting it.
 * So we gate every design BEFORE it can reach the factory.
 *
 *   status:
 *     approved  – safe to fulfil (curated-library art, or cleared by review/detector)
 *     review    – a human must approve
 *     blocked   – cannot be printed (an obvious IP / abuse signal)
 *
 * The image "brains" is a PLUGGABLE detector (setDetector) so a cloud vision
 * API drops in later with zero changes here. Until then we run free signals:
 *   • curated-library art is pre-vetted              -> approved
 *   • a risky filename (franchise/brand/celeb/poster) -> flagged but still
 *     APPROVED (the escrow model means an upload is never blocked or delayed
 *     at the front — a human reviews it in escrow before release; this is
 *     the real, current behavior of moderation.py's check(), not a bug)
 *   • everything else                                 -> approved
 */

export const APPROVED = "approved";
export const REVIEW = "review";
export const BLOCKED = "blocked";
export const STATUSES = [APPROVED, REVIEW, BLOCKED] as const;
export type ModerationStatus = (typeof STATUSES)[number];

export interface ModerationVerdict {
  status: ModerationStatus;
  reason: string;
  auto: boolean;
  flag: string | null;
}

// Filename red-flags — a cheap first pass. Users can rename files, so this
// only AUTO-FLAGS the lazy/obvious cases; the real backstop is human review
// of every upload. Extend freely; a cloud detector would make this stronger.
const BLOCK_TERMS = [
  // franchises / studios / brands
  "disney", "pixar", "marvel", "star wars", "starwars", "harry potter", "pokemon",
  "pokémon", "nintendo", "nike", "adidas", "jordan", "gucci", "louis vuitton",
  "supreme", "chanel", "prada", "ferrari", "lamborghini", "coca cola", "coca-cola",
  "nasa", "nfl", "nba", "fifa", "uefa", "premier league", "playstation", "xbox",
  // movies / posters
  "movie poster", "film poster", "godfather", "tarantino", "pulp fiction", "django",
  "blade runner", "scarface", "joker", "batman", "superman", "spiderman", "spider-man",
  "avengers", "james bond",
  // people / celebrity
  "celebrity", "michael jackson", "kanye", "drake", "beyonce", "beyoncé", "rihanna",
  "messi", "ronaldo", "taylor swift",
];
const BLOCK_RE = new RegExp(BLOCK_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

// Pluggable cloud detector. Returning null/undefined means "no opinion" ->
// falls through to the filename-flag pass below.
export type Detector = (raw: ArrayBuffer, filename: string) => Promise<Partial<ModerationVerdict> | null> | Partial<ModerationVerdict> | null;
let detector: Detector | null = null;

export function setDetector(fn: Detector | null): void {
  detector = fn;
}

export function hasDetector(): boolean {
  return detector !== null;
}

function filenameFlag(filename: string): string | null {
  // Normalise separators so "star-wars_poster.jpg" matches the term "star wars".
  const norm = (filename ?? "").replace(/[-_.]+/g, " ");
  const m = BLOCK_RE.exec(norm);
  return m ? m[0] : null;
}

/**
 * Return a moderation verdict for a design.
 *
 * source: 'library' (our curated, pre-vetted art) | 'upload' (a user's file).
 *
 * POLICY: the customer never waits and is never blocked at upload. They
 * confirm (via the originality reminder) that the work is their own, pay,
 * and the order goes into ESCROW. A human reviews it there — before anything
 * reaches the factory — and releases, asks for a redo, or refunds. So an
 * upload is always ACCEPTED here; a risky filename is merely FLAGGED for
 * that escrow review. (A real cloud detector, if plugged in, may still
 * authoritatively block.)
 */
export async function check(filename: string = "", raw: ArrayBuffer | null = null, source: string = "upload"): Promise<ModerationVerdict> {
  if (source === "library") {
    return { status: APPROVED, reason: "Curated design — pre-approved.", auto: true, flag: null };
  }

  // An optional cloud detector remains authoritative (can block confidently).
  if (detector !== null && raw !== null) {
    let verdict: Partial<ModerationVerdict> | null = null;
    try {
      verdict = await detector(raw, filename);
    } catch {
      verdict = null;
    }
    if (verdict && verdict.status && (STATUSES as readonly string[]).includes(verdict.status)) {
      return {
        status: verdict.status,
        reason: verdict.reason ?? "",
        auto: true,
        flag: verdict.flag ?? null,
      };
    }
  }

  const flagged = filenameFlag(filename);
  if (flagged) {
    // Accepted, but flagged so the human reviewer scrutinises it before release.
    return {
      status: APPROVED,
      auto: true,
      flag: flagged,
      reason: `⚠ Possible IP match in filename (“${flagged}”) — review before release.`,
    };
  }

  return { status: APPROVED, auto: true, flag: null, reason: "" };
}

export function label(status: string): string {
  return (
    ({ [APPROVED]: "Approved to print", [REVIEW]: "Pending quick review", [BLOCKED]: "Can't print this design" } as Record<string, string>)[status] ??
    status
  );
}
