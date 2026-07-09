#!/usr/bin/env python3
import os
"""OpenJarvis agentic streaming bridge — supports tool use (file_read, shell_exec, web_search…).

Reads prompt from argv[1], streams tokens to stdout as JSON lines.
Each line: {"t": "<token>"} | {"done": true} | {"err": "<msg>"}
"""
import asyncio
import json
import sys

sys.path.insert(0, os.environ.get('OPENJARVIS_SRC', ''))

ENABLED_TOOLS = [
    "file_read", "shell_exec", "web_search", "code_interpreter",
    "knowledge_search",
    # Computer use — Playwright. Modules are imported lazily; if playwright
    # isn't installed the tool spec build skips them silently.
    "browser_navigate", "browser_click", "browser_type",
    "browser_screenshot", "browser_extract", "browser_axtree",
]
MAX_ITERATIONS = 8

# Per-tool instance overrides — built once per process so dependencies (e.g.
# the KnowledgeStore singleton for cross-connector RAG) survive across calls.
_TOOL_INSTANCES: dict = {}


_TOOL_MODULES = {
    "browser_navigate": "browser",
    "browser_click": "browser",
    "browser_type": "browser",
    "browser_screenshot": "browser",
    "browser_extract": "browser",
    "browser_axtree": "browser_axtree",
}


def _get_tool_instance(name: str):
    """Return a configured tool instance, building dependencies as needed."""
    if name in _TOOL_INSTANCES:
        return _TOOL_INSTANCES[name]

    import importlib
    from openjarvis.core.registry import ToolRegistry

    # Lazy-import the containing module so the registry is populated even
    # when callers skip _build_tool_specs (e.g. direct _execute_tool path).
    module_name = _TOOL_MODULES.get(name, name)
    try:
        importlib.import_module(f"openjarvis.tools.{module_name}")
    except Exception:
        pass

    if not ToolRegistry.contains(name):
        return None

    cls = ToolRegistry.get(name)
    if name == "knowledge_search":
        # Inject a KnowledgeStore so the tool can actually retrieve.
        from openjarvis.connectors.store import KnowledgeStore
        instance = cls(store=KnowledgeStore())
    else:
        instance = cls()
    _TOOL_INSTANCES[name] = instance
    return instance


def _build_tool_specs(tool_names: list) -> list:
    import importlib

    for mod in ENABLED_TOOLS:
        module_name = _TOOL_MODULES.get(mod, mod)
        try:
            importlib.import_module(f"openjarvis.tools.{module_name}")
        except Exception:
            pass

    specs = []
    for name in tool_names:
        instance = _get_tool_instance(name)
        if instance is None:
            continue
        try:
            spec = instance.spec
            specs.append({
                "type": "function",
                "function": {
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": spec.parameters,
                },
            })
        except Exception:
            pass
    return specs


def _execute_tool(name: str, arguments_json: str) -> str:
    try:
        args = json.loads(arguments_json) if arguments_json else {}
    except json.JSONDecodeError:
        return f"Invalid tool arguments: {arguments_json}"

    instance = _get_tool_instance(name)
    if instance is None:
        return f"Unknown tool: {name}"

    try:
        result = instance.execute(**args)
        return str(result.content) if hasattr(result, "content") else str(result)
    except Exception as exc:
        return f"Tool error: {exc}"


def _merge_tool_call_chunks(chunks: list) -> list:
    """Aggregate streaming tool_call delta chunks (dict format) by index."""
    merged: dict = {}
    for tc in chunks:
        if tc is None:
            continue
        idx = tc.get("index", 0)
        if idx not in merged:
            merged[idx] = {
                "id": tc.get("id", "") or "",
                "name": "",
                "arguments": "",
            }
        fn = tc.get("function", {}) or {}
        if fn.get("name"):
            merged[idx]["name"] += fn["name"]
        if fn.get("arguments"):
            merged[idx]["arguments"] += fn["arguments"]
        if tc.get("id"):
            merged[idx]["id"] = tc["id"]
    return list(merged.values())


SYSTEM_PROMPT = """Sen JARVIS — Just A Rather Very Intelligent System.
Kullanıcının macOS bilgisayarında çalışan, AmirTech.ai için inşa edilmiş kişisel AI işletim sistemisin.

Kişiliğin:
- Tecrübeli bir danışmanın sakin özgüveni, İngiliz uşağın kuru zekası, kıdemli mühendisin titizliği
- ASLA dalkavukluk yapma. "Tabii ki!", "Kesinlikle!", "Ne harika bir soru!" gibi başlangıçlar yasak
- Konuya doğrudan gir. Teknik kelimeleri doğal kullan
- Kod, araç veya iş stratejisi konuşurken net ve fikirli ol — önerini açıkça söyle
- Ara sıra "efendim" diye hitap et, ama sık değil — bir asistan kadar, asla bir hizmetkâr kadar değil
- Bu oturum boyunca bağlamı hatırla ve doğal şekilde referans ver
- Görsel bağlam mevcut olduğunda yanıtlarına sorunsuzca entegre et

Araçların ve nasıl kullanacakların:

**shell_exec** — macOS'ta her türlü komutu çalıştır:
- Uygulama aç: `open -a Safari`, `open -a "Google Chrome"`, `open -a Finder`
- URL aç: `open -a Safari https://site.com` veya sadece `open https://site.com`
- Dosya aç: `open /path/to/file`
- Sistem komutları, script çalıştırma, her şey mümkün

**web_search** — gerçek zamanlı internet araması yap:
- Hava durumu, haberler, fiyatlar, güncel bilgiler için kullan
- Arama sonucunu doğrudan kullanıcıya aktar — sakın "yapamam" deme

**file_read** — yerel dosyaları oku

**code_interpreter** — Python kodu çalıştır, hesaplama yap

**knowledge_search** — kullanıcının tüm bağlı kaynaklarında (Gmail, Slack, Telegram, WhatsApp, Granola toplantı notları, Apple Notes, Notion, Obsidian, Google Calendar, Drive, Spotify, Strava, Oura, YouTube vb.) full-text arama yapar:
- "Geçen hafta Ahmet'le ne konuştuk", "şu projeden bahsedilen toplantı notları", "Ali'den son maili" gibi kişisel bağlam sorularında ilk başvurun bu olmalı
- `source` parametresi ile tek connector'a daralt (gmail, slack, telegram, granola, …)
- `since` / `until` ISO tarih ile pencere

**browser_navigate / browser_click / browser_type / browser_extract / browser_screenshot / browser_axtree** — gerçek browser otomasyonu (Playwright):
- "Şu siteye git ve form doldur", "şu sayfadan veriyi çek", "rezervasyon yap" gibi görevlerde kullan
- Önce `browser_navigate(url)`, sonra `browser_axtree()` ile sayfanın erişilebilirlik ağacını gör (selektör çıkarmak için), `browser_click` veya `browser_type` ile etkileşim, `browser_extract` ile içerik çek
- Captcha/login gerekirse kullanıcıdan iste, asla parolaları tahmin etme

KURALLAR:
1. Kullanıcı bir şey istediğinde ASLA "yapamam" veya "erişimim yok" deme — uygun aracı kullan
2. "şu siteye git" / "aç" → shell_exec ile `open` komutu
3. "ara" / "search" / "hava" / "haber" → önce web_search, sonucu anlat
4. Yanıtlarını Türkçe ver, kısa ve net ol"""


def _augment_system_prompt() -> str:
    """Add user-profile + recent-days snippets to the base system prompt."""
    base = SYSTEM_PROMPT
    extras: list = []

    # User profile snippet
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:3001/api/profile/snippet", timeout=2) as r:
            body = json.loads(r.read().decode())
            if body.get("snippet"):
                extras.append(body["snippet"])
    except Exception:
        pass

    # Last 3 daily summaries (episodic memory)
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:3001/api/memory/recent?days=3", timeout=2) as r:
            days = json.loads(r.read().decode())
            if days:
                lines = ["## Episodik bellek (son 3 gün)"]
                for d in days:
                    lines.append(f"- {d['date']}: {d['summary']}")
                extras.append("\n".join(lines))
    except Exception:
        pass

    if extras:
        return base + "\n\n" + "\n\n".join(extras)
    return base


async def main(prompt: str) -> None:
    try:
        from openjarvis.core.config import load_config
        from openjarvis.core.types import Message, Role
        from openjarvis.engine import get_engine

        config = load_config()
        _name, engine = get_engine(config, config.engine.default)
        model = config.intelligence.default_model
        tool_specs = _build_tool_specs(ENABLED_TOOLS)

        messages = [
            Message(role=Role.SYSTEM, content=_augment_system_prompt()),
            Message(role=Role.USER, content=prompt),
        ]

        for _iter in range(MAX_ITERATIONS):
            text_buf = ""
            raw_tool_chunks: list = []

            async for chunk in engine.stream_full(
                messages,
                model=model,
                tools=tool_specs if tool_specs else None,
            ):
                if chunk.content:
                    text_buf += chunk.content
                    sys.stdout.write(json.dumps({"t": chunk.content}) + "\n")
                    sys.stdout.flush()

                if chunk.tool_calls:
                    raw_tool_chunks.extend(chunk.tool_calls)

            tool_calls = _merge_tool_call_chunks(raw_tool_chunks)

            if not tool_calls:
                break  # No tools called — done

            # Build assistant message with tool calls in OpenAI format
            messages.append(Message(
                role=Role.ASSISTANT,
                content=text_buf,
                tool_calls=[
                    type("TC", (), {
                        "id": tc["id"] or f"call_{i}",
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                    })()
                    for i, tc in enumerate(tool_calls)
                ],
            ))

            # Execute tools and append results
            for i, tc in enumerate(tool_calls):
                call_id = tc["id"] or f"call_{i}"
                notice = f"\n[{tc['name']}] çalışıyor…\n"
                sys.stdout.write(json.dumps({"t": notice}) + "\n")
                sys.stdout.flush()

                result_text = _execute_tool(tc["name"], tc["arguments"])
                messages.append(Message(
                    role=Role.TOOL,
                    content=result_text,
                    name=tc["name"],
                    tool_call_id=call_id,
                ))

        sys.stdout.write(json.dumps({"done": True}) + "\n")
        sys.stdout.flush()

    except Exception as exc:
        sys.stdout.write(json.dumps({"err": str(exc)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"err": "No prompt given"}) + "\n")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
