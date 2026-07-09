"""Action approval guard — block-and-prompt for risky tool calls.

Tools may register themselves as "risky" (shell_exec, mail_send, file_write,
etc.). When an agent invokes a risky tool, the guard creates a pending request
in this in-memory queue and the request blocks until either:
  - user approves via /approvals/decide POST → tool runs
  - user rejects → tool returns ERROR
  - timeout (default 30s) → tool returns ERROR

UI (preferences page) polls /approvals/list and exposes Approve/Reject buttons.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
from dataclasses import dataclass, field

DEFAULT_TIMEOUT = float(os.getenv("APPROVAL_TIMEOUT_SEC", "60"))


@dataclass
class _Request:
    id: str
    tool: str
    args: dict
    created_at: float
    decision: str | None = None  # 'approved' | 'rejected'
    event: asyncio.Event = field(default_factory=asyncio.Event)


# Politika (kullanıcı tercihi 2026-06-12): TAM erişim — tool'lar onaysız çalışır,
# SADECE yıkıcı işlemler (silme/kaldırma/format/disk vb.) onaya takılır.
# İsim-bazlı guard'a tool eklemek istersen: APPROVAL_RISKY_TOOLS=tool1,tool2
RISKY_TOOLS = {
    t.strip() for t in os.getenv("APPROVAL_RISKY_TOOLS", "").split(",") if t.strip()
}

# Not: "rm\s...\b" kalıbı "rm -rf"i YAKALAMIYORDU (boşluk+tire arasında \b yok).
# Her alternatif kendi sınırını taşır.
# NOT: Bu tam bir sandbox DEĞİL (kullanıcı politikası = tam erişim); bariz yıkıcı
# ve obfuscate-edilmiş-exec kalıplarını ONAYA takan bir güvenlik ağıdır. Turing-
# complete shell'de her bypass'ı kapatmak imkansız; amaç KAZARA yıkımı yakalamak +
# en yaygın encode-and-exec vektörlerini de kapıya getirmek.
DESTRUCTIVE_RE = re.compile(
    r"(\b(?:rm|rmdir|sudo|srm|shred|killall)\s)"
    r"|(\bdd\s+if=)"
    r"|(\bmkfs)"
    r"|(\b(?:chown|chmod)\s+-R\b)"
    r"|(\blaunchctl\s+(?:remove|bootout)\b)"
    r"|(\bdiskutil\s+erase)"
    r"|(\bdrop\s+(?:table|database)\b)"
    r"|(\btruncate\s+table\b)"
    r"|(\bdelete\b)"
    r"|(\buninstall\b)"
    # Obfuscate-edilmiş / uzaktan yürütme vektörleri (encode→shell'e boru):
    r"|(\|\s*(?:sh|bash|zsh|dash|python3?|perl|ruby|node)\b)"  # pipe-to-interpreter
    r"|(\bbase64\s+(?:-d|-D|--decode)\b)"  # base64 decode (genelde exec öncesi)
    r"|(\b(?:xxd|xdd)\s+-r\b)"  # hex→binary decode
    r"|(\beval\s)"  # eval <string>
    r"|(\b(?:python3?|perl|ruby|node)\s+-\w*[ce]\b)",  # inline kod: python -c / node -e
    re.IGNORECASE,
)


def _enabled() -> bool:
    val = os.getenv("APPROVAL_GUARD", "auto").lower().strip()
    return val not in ("off", "false", "0", "disabled")


def needs_approval(tool: str, args: dict) -> bool:
    if not _enabled():
        return False
    if tool in RISKY_TOOLS:
        return True
    # Yıkıcı argüman deseni HER tool'da onaya takılır (silme/kaldırma koruması).
    raw = " ".join(str(v) for v in (args or {}).values())
    if DESTRUCTIVE_RE.search(raw):
        return True
    return False


_pending: dict[str, _Request] = {}


def list_pending() -> list[dict]:
    return [
        {
            "id": r.id,
            "tool": r.tool,
            "args": r.args,
            "created_at": r.created_at,
            "age_sec": int(time.time() - r.created_at),
        }
        for r in _pending.values()
        if r.decision is None
    ]


def decide(req_id: str, decision: str) -> bool:
    req = _pending.get(req_id)
    if not req or req.decision is not None:
        return False
    if decision not in ("approved", "rejected"):
        return False
    req.decision = decision
    req.event.set()
    return True


async def request(tool: str, args: dict, timeout: float = DEFAULT_TIMEOUT) -> str:
    """Block until decision or timeout. Returns 'approved' | 'rejected' | 'timeout'."""
    rid = uuid.uuid4().hex[:10]
    req = _Request(id=rid, tool=tool, args=dict(args or {}), created_at=time.time())
    _pending[rid] = req
    try:
        await asyncio.wait_for(req.event.wait(), timeout=timeout)
        return req.decision or "rejected"
    except asyncio.TimeoutError:
        return "timeout"
    finally:
        _pending.pop(rid, None)
