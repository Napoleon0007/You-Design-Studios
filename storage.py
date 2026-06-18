"""
File storage abstraction.

Gelato fetches print files from a PUBLIC URL, so generated print files (and the
raw uploaded art) need to live somewhere reachable. For now this writes to a
local data dir served by Flask at /files/<key>; swapping to Cloudflare R2 / S3
later is a one-function change (`put`) — nothing else in the app changes.

NOTE for production:
  * Set PUBLIC_BASE_URL to the deployed origin (e.g. the Railway URL) so the
    URLs handed to Gelato are absolute.
  * Local disk on Railway is EPHEMERAL — mount a Volume at DATA_DIR, or move
    `put`/`open_bytes` to object storage, before taking real orders.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
FILES_DIR = DATA_DIR / "files"
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")


def _ensure() -> None:
    FILES_DIR.mkdir(parents=True, exist_ok=True)


def new_key(prefix: str, ext: str) -> str:
    ext = ext.lower().lstrip(".")
    return f"{prefix}_{secrets.token_hex(8)}.{ext}"


def put(data: bytes, key: str) -> str:
    """Store bytes under `key`; return its public URL."""
    _ensure()
    (FILES_DIR / key).write_bytes(data)
    return public_url(key)


def open_bytes(key: str) -> Optional[bytes]:
    fp = FILES_DIR / key
    if not fp.exists() or not fp.is_file():
        return None
    return fp.read_bytes()


def path_for(key: str) -> Path:
    return FILES_DIR / key


def public_url(key: str) -> str:
    """Absolute URL when PUBLIC_BASE_URL is set (prod / Gelato), else a path."""
    return f"{PUBLIC_BASE_URL}/files/{key}" if PUBLIC_BASE_URL else f"/files/{key}"
