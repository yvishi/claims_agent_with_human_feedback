"""Settings, read from the environment (and `.env` if present). No secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    claim_pack_dir: Path
    app_db_url: str
    mock_db_url: str
    mock_base_url: str
    cache_dir: Path
    fault_mode: str
    rules_file: Path


@lru_cache
def get_settings() -> Settings:
    pack = os.getenv("CLAIM_PACK_DIR") or str(REPO_ROOT.parent / "claim-pack-public")
    return Settings(
        claim_pack_dir=Path(pack).resolve(),
        app_db_url=os.getenv("APP_DB_URL", ""),
        mock_db_url=os.getenv("MOCK_DB_URL", ""),
        mock_base_url=os.getenv("MOCK_BASE_URL", "http://127.0.0.1:8001"),
        cache_dir=Path(os.getenv("CACHE_DIR") or REPO_ROOT / ".cache").resolve(),
        fault_mode=os.getenv("FAULT_MODE", "off"),
        rules_file=Path(os.getenv("RULES_FILE") or REPO_ROOT / "harborline" / "rules" / "v1.yaml"),
    )
