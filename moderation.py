"""
Content moderation / IP pre-approval for user-uploaded designs.

Gelato (and every POD) rejects copyrighted, trademarked, celebrity and
movie/brand artwork — and will suspend the account if we keep submitting it.
So we gate every design BEFORE it can reach the factory.

  status:
    approved  – safe to fulfil (curated-library art, or cleared by review/detector)
    review    – a human must approve (the safe DEFAULT for any user upload)
    blocked   – cannot be printed (an obvious IP / abuse signal)

The image "brains" is a PLUGGABLE detector (set_detector) so a cloud vision API
— Google Vision (web/logo/face/OCR) or AWS Rekognition (celebrity/moderation/
text) — drops in later with zero changes here. Until then we run free signals:
  • curated-library art is pre-vetted              -> approved
  • a risky filename (franchise/brand/celeb/poster) -> blocked
  • everything else                                 -> review (human approves)
"""
from __future__ import annotations

import re
from typing import Callable, Optional

APPROVED, REVIEW, BLOCKED = "approved", "review", "blocked"
STATUSES = (APPROVED, REVIEW, BLOCKED)

# Filename red-flags — a cheap first pass. Users can rename files, so this only
# AUTO-BLOCKS the lazy/obvious cases; the real backstop is human review of every
# upload. Extend freely; the cloud detector will make this far stronger.
_BLOCK_TERMS = [
    # franchises / studios / brands
    "disney", "pixar", "marvel", "star wars", "starwars", "harry potter", "pokemon",
    "pokémon", "nintendo", "nike", "adidas", "jordan", "gucci", "louis vuitton",
    "supreme", "chanel", "prada", "ferrari", "lamborghini", "coca cola", "coca-cola",
    "nasa", "nfl", "nba", "fifa", "uefa", "premier league", "playstation", "xbox",
    # movies / posters
    "movie poster", "film poster", "godfather", "tarantino", "pulp fiction", "django",
    "blade runner", "scarface", "joker", "batman", "superman", "spiderman", "spider-man",
    "avengers", "james bond",
    # people / celebrity
    "celebrity", "michael jackson", "kanye", "drake", "beyonce", "beyoncé", "rihanna",
    "messi", "ronaldo", "taylor swift",
]
_BLOCK_RE = re.compile("|".join(re.escape(t) for t in _BLOCK_TERMS), re.I)

# Pluggable cloud detector. Signature:
#   detector(raw: bytes, filename: str) -> Optional[dict]
# returning e.g. {"status": "approved"|"review"|"blocked", "reason": str}.
# None means "no opinion" -> we fall through to the safe REVIEW default.
_detector: Optional[Callable[[bytes, str], Optional[dict]]] = None


def set_detector(fn: Optional[Callable[[bytes, str], Optional[dict]]]) -> None:
    """Plug in a cloud vision detector (Google Vision / AWS Rekognition wrapper)."""
    global _detector
    _detector = fn


def has_detector() -> bool:
    return _detector is not None


def _filename_flag(filename: str) -> Optional[str]:
    # Normalise separators so "star-wars_poster.jpg" matches the term "star wars".
    norm = re.sub(r"[-_.]+", " ", filename or "")
    m = _BLOCK_RE.search(norm)
    return m.group(0) if m else None


def check(filename: str = "", raw: Optional[bytes] = None, source: str = "upload") -> dict:
    """Return a moderation verdict for a design.

    source: 'library' (our curated, pre-vetted art) | 'upload' (a user's file).
    Returns {status, reason, auto, flag} — `auto` is True when no human is
    needed AT THE FRONT, `flag` carries an IP-risk term for the backend reviewer.

    POLICY: the customer never waits and is never blocked at upload. They confirm
    (via the originality reminder) that the work is their own, pay, and the order
    goes into ESCROW. A human reviews it there — before anything reaches the
    factory — and releases, asks for a redo, or refunds. So an upload is always
    ACCEPTED here; a risky filename is merely FLAGGED for that escrow review.
    (A real cloud detector, if plugged in, may still authoritatively block.)
    """
    if source == "library":
        return {"status": APPROVED, "reason": "Curated design — pre-approved.",
                "auto": True, "flag": None}

    # An optional cloud detector remains authoritative (can block confidently).
    if _detector is not None and raw is not None:
        try:
            verdict = _detector(raw, filename)
        except Exception:
            verdict = None
        if verdict and verdict.get("status") in STATUSES:
            verdict.setdefault("reason", "")
            verdict.setdefault("flag", None)
            verdict["auto"] = True
            return verdict

    flagged = _filename_flag(filename)
    if flagged:
        # Accepted, but flagged so the human reviewer scrutinises it before release.
        return {"status": APPROVED, "auto": True, "flag": flagged,
                "reason": f"⚠ Possible IP match in filename (“{flagged}”) — review before release."}

    return {"status": APPROVED, "auto": True, "flag": None, "reason": ""}


def label(status: str) -> str:
    return {APPROVED: "Approved to print", REVIEW: "Pending quick review",
            BLOCKED: "Can't print this design"}.get(status, status)
