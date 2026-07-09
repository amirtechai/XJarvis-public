"""Web search & fetch.

`web_search` öncelikle Tavily AI Search (LLM-optimized snippets) kullanır;
TAVILY_API_KEY yoksa Serper.dev'e, o da yoksa DuckDuckGo HTML'e düşer.
"""

from __future__ import annotations

import os
import re
from html.parser import HTMLParser

import httpx

from .base import ToolSpec, registry

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) XJarvis/1.0"


async def _tavily_search(query: str, max_results: int) -> str | None:
    key = os.getenv("TAVILY_API_KEY", "").strip()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": True,
                    "search_depth": "basic",
                },
            )
        if r.status_code != 200:
            return None
        j = r.json()
        out = []
        if j.get("answer"):
            out.append(f"💡 {j['answer']}")
        for it in (j.get("results") or [])[:max_results]:
            out.append(
                f"• {it.get('title', '')}\n  {it.get('url', '')}\n  {it.get('content', '')[:240]}"
            )
        return "\n\n".join(out) if out else None
    except Exception:
        return None


async def _brave_search(query: str, max_results: int) -> str | None:
    key = os.getenv("BRAVE_API_KEY", "").strip()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={"X-Subscription-Token": key, "Accept": "application/json"},
                params={"q": query, "count": max_results},
            )
        if r.status_code != 200:
            return None
        j = r.json()
        out = []
        for it in (j.get("web", {}).get("results") or [])[:max_results]:
            out.append(
                f"• {it.get('title', '')}\n  {it.get('url', '')}\n  {it.get('description', '')[:240]}"
            )
        return "\n\n".join(out) if out else None
    except Exception:
        return None


async def _serper_search(query: str, max_results: int) -> str | None:
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": key, "Content-Type": "application/json"},
                json={"q": query, "num": max_results},
            )
        if r.status_code != 200:
            return None
        j = r.json()
        out = []
        for it in (j.get("organic") or [])[:max_results]:
            out.append(
                f"• {it.get('title', '')}\n  {it.get('link', '')}\n  {it.get('snippet', '')}"
            )
        return "\n\n".join(out) if out else None
    except Exception:
        return None


async def web_search(query: str, max_results: int = 5) -> str:
    """Tavily → Brave → Serper → DuckDuckGo cascade. İlk başarılı sağlayıcı döner."""
    res = await _tavily_search(query, max_results)
    if res:
        return res
    res = await _brave_search(query, max_results)
    if res:
        return res
    res = await _serper_search(query, max_results)
    if res:
        return res
    # Fallback: DuckDuckGo HTML
    url = "https://html.duckduckgo.com/html/"
    async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": UA}) as c:
        r = await c.post(url, data={"q": query})
    if r.status_code != 200:
        return f"ERROR: search returned {r.status_code}"
    # Naive extraction: titles + snippets
    pattern = re.compile(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
        re.DOTALL,
    )
    results = []
    for m in pattern.finditer(r.text):
        link, title, snippet = (
            m.group(1),
            _strip_html(m.group(2)),
            _strip_html(m.group(3)),
        )
        results.append(f"• {title}\n  {link}\n  {snippet}")
        if len(results) >= max_results:
            break
    if not results:
        return "Hiç sonuç bulunamadı."
    return "\n\n".join(results)


async def web_fetch(url: str, max_chars: int = 8000) -> str:
    """Fetch a URL and return text content (HTML stripped)."""
    async with httpx.AsyncClient(
        timeout=20.0, headers={"User-Agent": UA}, follow_redirects=True
    ) as c:
        try:
            r = await c.get(url)
        except Exception as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR: {r.status_code}"
    text = _strip_html(r.text)
    return text[:max_chars]


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip:
            return
        s = data.strip()
        if s:
            self.parts.append(s)


def _strip_html(html: str) -> str:
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    return re.sub(r"\s+", " ", " ".join(p.parts)).strip()


registry.register(
    ToolSpec(
        name="web_search",
        description="İnternet araması yap (DuckDuckGo). Hava, haber, fiyat, güncel bilgi için.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "description": "Varsayılan 5"},
            },
            "required": ["query"],
        },
        fn=web_search,
    )
)

registry.register(
    ToolSpec(
        name="web_fetch",
        description="Bir URL'in içeriğini getir (HTML temizlenmiş, max 8000 karakter).",
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "max_chars": {"type": "integer"},
            },
            "required": ["url"],
        },
        fn=web_fetch,
    )
)


async def deep_research(topic: str, max_sources: int = 5) -> str:
    """DERİN ARAŞTIRMA: çok-kaynak web araması + en iyi kaynakların TAM içeriğini
    getirir, ham materyali döndürür. Ana ajan bundan kapsamlı cevap/rapor sentezler."""
    n = max(2, min(int(max_sources or 5), 8))
    search = await web_search(topic, max_results=n)
    urls = re.findall(r"https?://[^\s)\]]+", search)
    seen, picked = set(), []
    for u in urls:
        u = u.rstrip(".,)")
        if u not in seen:
            seen.add(u)
            picked.append(u)
        if len(picked) >= n:
            break
    parts = [f"# DERİN ARAŞTIRMA: {topic}\n\n## Arama özeti\n{search}\n"]
    for i, url in enumerate(picked, 1):
        try:
            content = await web_fetch(url, max_chars=4500)
        except Exception as e:
            content = f"(getirilemedi: {e})"
        parts.append(f"## Kaynak {i}: {url}\n{content}\n")
    parts.append(
        "\n[TALİMAT] Yukarıdaki kaynakları sentezle: net, yapılandırılmış, "
        "kaynak-atıflı bir cevap ver. Çelişkileri belirt."
    )
    return "\n".join(parts)[:32000]


def _md_to_html(md: str) -> str:
    """Hafif markdown→HTML (başlık, liste, kalın, paragraf)."""
    import html as _h

    out, in_ul = [], False
    for raw in (md or "").split("\n"):
        line = raw.rstrip()
        esc = _h.escape(line)
        esc = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", esc)
        if not line.strip():
            if in_ul:
                out.append("</ul>")
                in_ul = False
            continue
        if line.startswith("### "):
            out.append(f"<h3>{esc[4:]}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{esc[3:]}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{esc[2:]}</h1>")
        elif line.lstrip().startswith(("- ", "* ", "• ")):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{esc.lstrip()[2:]}</li>")
        else:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<p>{esc}</p>")
    if in_ul:
        out.append("</ul>")
    return "\n".join(out)


async def save_pdf_report(title: str, content: str) -> str:
    """PDF RAPOR: başlık + (markdown) içerikten şık bir PDF üretip ~/Desktop'a kaydeder."""
    import os
    import time
    import html as _h
    from .screen import _run  # mevcut güvenli exec yardımcısı (yeni subprocess yok)

    desktop = os.path.expanduser("~/Desktop")
    os.makedirs(desktop, exist_ok=True)
    safe = (
        "".join(
            c for c in (title or "rapor") if c.isalnum() or c in " -_ğüşıöçĞÜŞİÖÇ"
        ).strip()[:60]
        or "rapor"
    )
    stamp = int(time.time())
    htmlpath = f"/tmp/xjarvis_report_{stamp}.html"
    pdfpath = os.path.join(desktop, f"{safe}.pdf")
    doc = (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;"
        "max-width:760px;margin:40px auto;line-height:1.6;padding:0 24px}"
        "h1{color:#0b8a55;border-bottom:2px solid #0b8a55;padding-bottom:6px}"
        "h2{color:#08406a;margin-top:1.4em}h3{color:#444}"
        "a{color:#0a6ebd;word-break:break-all}li{margin:.2em 0}"
        "footer{margin-top:40px;color:#999;font-size:12px;border-top:1px solid #ddd;padding-top:8px}"
        "</style></head><body>"
        f"<h1>{_h.escape(title or 'Rapor')}</h1>{_md_to_html(content)}"
        f"<footer>XJarvis · {time.strftime('%d.%m.%Y %H:%M')}</footer></body></html>"
    )
    with open(htmlpath, "w", encoding="utf-8") as f:
        f.write(doc)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    await _run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            "--virtual-time-budget=2500",
            f"--print-to-pdf={pdfpath}",
            f"file://{htmlpath}",
        ]
    )
    try:
        os.remove(htmlpath)
    except Exception:
        pass
    if os.path.exists(pdfpath):
        return f"PDF rapor kaydedildi: {pdfpath}"
    return "PDF oluşturulamadı (Chrome?)."


registry.register(
    ToolSpec(
        name="deep_research",
        description=(
            "DERİN WEB ARAŞTIRMASI: bir konuyu çok kaynaktan araştır (arama + en iyi "
            "sayfaların tam içeriği). 'şu konuda araştırma yap', 'detaylı araştır', "
            "'incele' gibi kapsamlı araştırma isteklerinde kullan; sonra cevabı sentezle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Araştırma konusu/sorusu"},
                "max_sources": {
                    "type": "integer",
                    "description": "Kaynak sayısı (2-8, vars. 5)",
                },
            },
            "required": ["topic"],
        },
        fn=deep_research,
    )
)

registry.register(
    ToolSpec(
        name="save_pdf_report",
        description=(
            "PDF RAPOR KAYDET: başlık + markdown içerikten şık PDF üretip kullanıcının "
            "Masaüstü'ne (~/Desktop) kaydeder. 'pdf yap', 'rapor kaydet', 'pdf olarak ver' "
            "dendiğinde cevabı/araştırmayı markdown olarak buraya ver."
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Rapor başlığı (dosya adı)"},
                "content": {
                    "type": "string",
                    "description": "Rapor içeriği (markdown)",
                },
            },
            "required": ["title", "content"],
        },
        fn=save_pdf_report,
    )
)
