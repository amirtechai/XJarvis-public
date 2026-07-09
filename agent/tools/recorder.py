"""Recorder tool — start/stop/status the workflow recorder."""
from __future__ import annotations

from .base import ToolSpec, registry
from ..memory import recorder as rec


async def recorder_start(name: str, description: str = "") -> str:
    return rec.start(name, description)


async def recorder_stop() -> str:
    return rec.stop()


async def recorder_status() -> str:
    return rec.status()


async def recorder_cancel() -> str:
    return rec.cancel()


for spec in [
    ToolSpec(
        name="recorder_start",
        description=(
            "Workflow kaydını başlat. Kullanıcı 'bunu kaydet' / 'bu işlemi öğren' "
            "derse çağır. recorder_stop'a kadar her tool çağrısı kaydedilir ve "
            "stop'ta skill markdown'a dönüştürülür."
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill adı (örn 'günlük-mail-temizlik')"},
                "description": {"type": "string", "description": "Bir cümle açıklama"},
            },
            "required": ["name"],
        },
        fn=recorder_start,
    ),
    ToolSpec(
        name="recorder_stop",
        description="Aktif kaydı bitir, agent/skills/ altına markdown skill yaz.",
        parameters={"type": "object", "properties": {}},
        fn=recorder_stop,
    ),
    ToolSpec(
        name="recorder_status",
        description="Kayıt durumu ve şu ana kadar kaydedilen adım sayısı.",
        parameters={"type": "object", "properties": {}},
        fn=recorder_status,
    ),
    ToolSpec(
        name="recorder_cancel",
        description="Aktif kaydı iptal et (skill yazma).",
        parameters={"type": "object", "properties": {}},
        fn=recorder_cancel,
    ),
]:
    registry.register(spec)
