"""Browser automation — Safari & Chrome tab control via AppleScript.

Supports:
- Open URL in new tab / current tab
- List open tabs (with title + URL)
- Close tab, switch tab
- Run JavaScript in active tab (Safari needs "Allow Apple Events from JavaScript"
  enabled in Develop menu; Chrome needs "Allow JavaScript from Apple Events")
- Form fill via JS injection
"""
from __future__ import annotations

import asyncio
import json
import os
from urllib.parse import urlparse

from .base import ToolSpec, registry


# Domain whitelist for browser_open — prevents the LLM from hallucinating
# URLs (e.g. "gero.ai") when the user asked for an in-app page like
# "multi tv". Internal XJarvis pages must go through xjarvis_page; this
# tool is only for genuine external websites the model is *sure* about.
#
# Add to BROWSER_WHITELIST via env BROWSER_WHITELIST_EXTRA (comma-sep).
DEFAULT_BROWSER_WHITELIST = {
    # Search engines
    "google.com", "bing.com", "duckduckgo.com", "kagi.com",
    # Localhost / dev
    "localhost", "127.0.0.1",
    # Docs & ref
    "wikipedia.org", "stackoverflow.com", "developer.mozilla.org",
    "github.com", "gitlab.com",
    # User-known services
    "youtube.com", "twitter.com", "x.com", "linkedin.com", "reddit.com",
    "notion.so", "linear.app", "jira.com", "atlassian.com",
    "openai.com", "anthropic.com", "claude.ai", "chat.openai.com",
    "binance.com", "coinbase.com", "tradingview.com",
    "gmail.com", "mail.google.com", "calendar.google.com",
    "drive.google.com", "docs.google.com",
    
    # News
    "haberturk.com", "ntv.com.tr", "hurriyet.com.tr", "milliyet.com.tr",
    "bbc.com", "cnn.com", "reuters.com",
}
_EXTRA = os.getenv("BROWSER_WHITELIST_EXTRA", "")
BROWSER_WHITELIST = DEFAULT_BROWSER_WHITELIST | {
    d.strip().lower() for d in _EXTRA.split(",") if d.strip()
}


def _is_url_allowed(url: str) -> tuple[bool, str]:
    """Validate URL against whitelist. Returns (ok, reason)."""
    try:
        p = urlparse(url if "://" in url else "https://" + url)
    except Exception as e:
        return False, f"URL parse hatası: {e}"
    host = (p.hostname or "").lower()
    if not host:
        return False, "Geçersiz URL — host bulunamadı"
    # Strip leading "www."
    bare = host[4:] if host.startswith("www.") else host
    # Match exact or as suffix of subdomain
    for allowed in BROWSER_WHITELIST:
        if bare == allowed or bare.endswith("." + allowed):
            return True, ""
    return False, host


async def _osa(script: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {err.decode().strip()}"
    return out.decode().strip() or "OK"


def _resolve_browser(name: str) -> str | None:
    n = (name or "safari").lower().strip()
    if n in ("safari",):
        return "Safari"
    if n in ("chrome", "google chrome"):
        return "Google Chrome"
    if n in ("arc",):
        return "Arc"
    if n in ("brave",):
        return "Brave Browser"
    if n in ("edge",):
        return "Microsoft Edge"
    return None


def _osa_quote(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


async def browser_open(url: str, browser: str = "safari", new_tab: bool = True) -> str:
    """Open URL. browser: safari | chrome | arc | brave | edge."""
    app = _resolve_browser(browser)
    if not app:
        return f"ERROR: unknown browser '{browser}'"
    ok, reason = _is_url_allowed(url)
    if not ok:
        # Surface a clear refusal so the agent can tell the user
        # "anlamadım / işlem başarısız" instead of silently opening a
        # hallucinated URL. The LLM sees this string and should relay it.
        return (
            f"REFUSED: '{reason}' whitelist'te değil — anlamadım, "
            f"komutu yeniden söyler misin? (XJarvis sayfası için "
            f"xjarvis_page kullan; harici site için tam URL ver.)"
        )
    u = _osa_quote(url)

    if app == "Safari":
        if new_tab:
            script = f'''
            tell application "Safari"
              activate
              if (count of windows) = 0 then
                make new document with properties {{URL:"{u}"}}
              else
                tell front window to set current tab to (make new tab with properties {{URL:"{u}"}})
              end if
            end tell
            return "OK"
            '''
        else:
            script = f'''
            tell application "Safari"
              activate
              if (count of windows) = 0 then
                make new document with properties {{URL:"{u}"}}
              else
                set URL of current tab of front window to "{u}"
              end if
            end tell
            return "OK"
            '''
    else:
        # Chromium-family
        if new_tab:
            script = f'''
            tell application "{app}"
              activate
              if (count of windows) = 0 then
                make new window
              end if
              tell front window to make new tab with properties {{URL:"{u}"}}
            end tell
            return "OK"
            '''
        else:
            script = f'''
            tell application "{app}"
              activate
              if (count of windows) = 0 then
                make new window with properties {{URL:"{u}"}}
              else
                set URL of active tab of front window to "{u}"
              end if
            end tell
            return "OK"
            '''
    return await _osa(script)


async def browser_tabs(browser: str = "safari") -> str:
    """List open tabs of a browser as JSON: [{window, index, title, url}]."""
    app = _resolve_browser(browser)
    if not app:
        return f"ERROR: unknown browser '{browser}'"

    if app == "Safari":
        script = '''
        set out to ""
        tell application "Safari"
          set wIdx to 0
          repeat with w in windows
            set wIdx to wIdx + 1
            set tIdx to 0
            repeat with t in tabs of w
              set tIdx to tIdx + 1
              set out to out & wIdx & "\t" & tIdx & "\t" & (name of t) & "\t" & (URL of t) & "\n"
            end repeat
          end repeat
        end tell
        return out
        '''
    else:
        script = f'''
        set out to ""
        tell application "{app}"
          set wIdx to 0
          repeat with w in windows
            set wIdx to wIdx + 1
            set tIdx to 0
            repeat with t in tabs of w
              set tIdx to tIdx + 1
              set out to out & wIdx & "\t" & tIdx & "\t" & (title of t) & "\t" & (URL of t) & "\n"
            end repeat
          end repeat
        end tell
        return out
        '''
    raw = await _osa(script)
    if raw.startswith("ERROR"):
        return raw
    tabs = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) >= 4:
            tabs.append({
                "window": int(parts[0]) if parts[0].isdigit() else parts[0],
                "index": int(parts[1]) if parts[1].isdigit() else parts[1],
                "title": parts[2],
                "url": parts[3],
            })
    return json.dumps(tabs, ensure_ascii=False)


async def browser_close_tab(browser: str = "safari", window: int = 1, index: int = 0) -> str:
    """Close a tab. index=0 → current tab; otherwise 1-based tab index in window."""
    app = _resolve_browser(browser)
    if not app:
        return f"ERROR: unknown browser '{browser}'"
    if app == "Safari":
        if index == 0:
            script = f'tell application "Safari" to close current tab of window {int(window)}'
        else:
            script = f'tell application "Safari" to close tab {int(index)} of window {int(window)}'
    else:
        if index == 0:
            script = f'tell application "{app}" to close active tab of window {int(window)}'
        else:
            script = f'tell application "{app}" to close tab {int(index)} of window {int(window)}'
    return await _osa(script + '\nreturn "OK"')


async def browser_switch_tab(browser: str = "safari", window: int = 1, index: int = 1) -> str:
    """Activate tab `index` (1-based) of window `window`."""
    app = _resolve_browser(browser)
    if not app:
        return f"ERROR: unknown browser '{browser}'"
    if app == "Safari":
        script = f'''
        tell application "Safari"
          activate
          tell window {int(window)} to set current tab to tab {int(index)}
        end tell
        return "OK"
        '''
    else:
        script = f'''
        tell application "{app}"
          activate
          tell window {int(window)} to set active tab index to {int(index)}
        end tell
        return "OK"
        '''
    return await _osa(script)


async def browser_js(browser: str = "safari", code: str = "") -> str:
    """Execute JavaScript in the active tab. Returns the JS expression's value
    as string. Requires:
    - Safari: Develop → Allow JavaScript from Apple Events
    - Chrome/Arc/Brave: View → Developer → Allow JavaScript from Apple Events
    """
    app = _resolve_browser(browser)
    if not app:
        return f"ERROR: unknown browser '{browser}'"
    if not code:
        return "ERROR: empty JS"
    js = _osa_quote(code)
    if app == "Safari":
        script = f'tell application "Safari" to do JavaScript "{js}" in current tab of front window'
    else:
        script = f'tell application "{app}" to execute active tab of front window javascript "{js}"'
    return await _osa(script)


async def browser_fill(browser: str, selector: str, value: str) -> str:
    """Fill a form field by CSS selector."""
    safe_val = value.replace("\\", "\\\\").replace("'", "\\'")
    safe_sel = selector.replace("\\", "\\\\").replace("'", "\\'")
    code = (
        f"(function(){{var e=document.querySelector('{safe_sel}');"
        f"if(!e)return 'ERR:not found';"
        f"e.focus();e.value='{safe_val}';"
        f"e.dispatchEvent(new Event('input',{{bubbles:true}}));"
        f"e.dispatchEvent(new Event('change',{{bubbles:true}}));"
        f"return 'OK';}})()"
    )
    return await browser_js(browser, code)


async def browser_click(browser: str, selector: str) -> str:
    """Click a DOM element by CSS selector."""
    safe_sel = selector.replace("\\", "\\\\").replace("'", "\\'")
    code = (
        f"(function(){{var e=document.querySelector('{safe_sel}');"
        f"if(!e)return 'ERR:not found';e.click();return 'OK';}})()"
    )
    return await browser_js(browser, code)


for spec in [
    ToolSpec(
        name="browser_open",
        description=(
            "Tarayıcıda URL aç. browser: safari | chrome | arc | brave | edge. "
            "new_tab=true ise yeni sekme; false → mevcut sekmeyi değiştir."
        ),
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "browser": {"type": "string"},
                "new_tab": {"type": "boolean"},
            },
            "required": ["url"],
        },
        fn=browser_open,
    ),
    ToolSpec(
        name="browser_tabs",
        description="Açık sekmeleri JSON listesi olarak döndür: [{window,index,title,url}].",
        parameters={
            "type": "object",
            "properties": {"browser": {"type": "string"}},
        },
        fn=browser_tabs,
    ),
    ToolSpec(
        name="browser_close_tab",
        description="Sekmeyi kapat. index=0 → aktif sekme. Aksi halde 1-tabanlı index.",
        parameters={
            "type": "object",
            "properties": {
                "browser": {"type": "string"},
                "window": {"type": "integer"},
                "index": {"type": "integer"},
            },
        },
        fn=browser_close_tab,
    ),
    ToolSpec(
        name="browser_switch_tab",
        description="Belirli sekmeye geç (window + 1-tabanlı index).",
        parameters={
            "type": "object",
            "properties": {
                "browser": {"type": "string"},
                "window": {"type": "integer"},
                "index": {"type": "integer"},
            },
            "required": ["index"],
        },
        fn=browser_switch_tab,
    ),
    ToolSpec(
        name="browser_js",
        description=(
            "Aktif sekmede JavaScript çalıştır ve değeri döndür. Safari/Chrome'da "
            "'Allow JavaScript from Apple Events' açık olmalı."
        ),
        parameters={
            "type": "object",
            "properties": {
                "browser": {"type": "string"},
                "code": {"type": "string"},
            },
            "required": ["code"],
        },
        fn=browser_js,
    ),
    ToolSpec(
        name="browser_fill",
        description="CSS selector ile form alanı doldur (input/textarea).",
        parameters={
            "type": "object",
            "properties": {
                "browser": {"type": "string"},
                "selector": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["selector", "value"],
        },
        fn=browser_fill,
    ),
    ToolSpec(
        name="browser_click",
        description="CSS selector'lı DOM öğesini tıkla.",
        parameters={
            "type": "object",
            "properties": {
                "browser": {"type": "string"},
                "selector": {"type": "string"},
            },
            "required": ["selector"],
        },
        fn=browser_click,
    ),
]:
    registry.register(spec)
