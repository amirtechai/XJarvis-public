"""Push-to-talk global hotkey daemon (saf Python / Quartz — kurulum gerektirmez).

CHORD: Option + A  (sol el — ⌥ serçe, A işaret parmağı).
  BASILI TUT (⌥ + A birlikte) → Jarvis dinler/kaydeder.
  BIRAK → komutu Groq STT ile yazıp işler.
Wake-word YOK, F5/dikte ile çakışma YOK, gürültüde %100 güvenilir.

Tuşu değiştirmek için env:
  PTT_KEYCODE=<kod>   (varsayılan 0 = A)
  PTT_MODIFIER=control|option|command|shift|none   (varsayılan option)
  Örnek kodlar: A=0, S=1, W=13, Q=12, <>=50, Space=49.

Teşhis:
  python3 -m voice.ptt_hotkey --keys    # basılan her tuşun keycode'unu yazar
  PTT_DEBUG=1 python3 -m voice.ptt_hotkey  # her tetik denemesini ayrıntılı yazar

İlk çalıştırmada macOS "Accessibility" izni ister:
  Ayarlar → Gizlilik ve Güvenlik → Erişilebilirlik → Terminal'i (veya
  python'u) ekle/işaretle. Sonra bu script'i yeniden başlat.
"""
from __future__ import annotations

import os
import sys
import threading
import urllib.request

import Quartz
from AppKit import NSEvent  # noqa: F401  (pyobjc yüklü mü teyit)

VOICE_URL = os.getenv("VOICE_PTT_URL", "http://localhost:8766")
KEYCODE = int(os.getenv("PTT_KEYCODE", "0"))  # A tuşu (Option+A chord)
DEBUG = os.getenv("PTT_DEBUG", "") not in ("", "0", "false")

_MOD_MASKS = {
    "control": Quartz.kCGEventFlagMaskControl,
    "option":  Quartz.kCGEventFlagMaskAlternate,
    "command": Quartz.kCGEventFlagMaskCommand,
    "shift":   Quartz.kCGEventFlagMaskShift,
    "none":    0,
}
MOD_NAME = os.getenv("PTT_MODIFIER", "option").lower().strip()
MOD_MASK = _MOD_MASKS.get(MOD_NAME, Quartz.kCGEventFlagMaskAlternate)

_pressed = False
_first_event_seen = False
_tap = None  # event tap (disable olunca yeniden açmak için)


def _post(path: str) -> None:
    def _do() -> None:
        try:
            req = urllib.request.Request(VOICE_URL + path, method="POST", data=b"{}",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
        except Exception as e:
            print(f"[ptt] POST {path} hata: {e}", file=sys.stderr)
    threading.Thread(target=_do, daemon=True).start()


def _service_up() -> bool:
    try:
        with urllib.request.urlopen(VOICE_URL + "/status", timeout=3) as resp:
            resp.read()
        return True
    except Exception:
        return False


def _on_down() -> None:
    global _pressed
    if _pressed:
        return
    _pressed = True
    print("[ptt] ▶ dinliyorum… (bırakınca işleyeceğim)")
    _post("/ptt/start")


def _on_up() -> None:
    global _pressed
    if not _pressed:
        return
    _pressed = False
    print("[ptt] ⏹ işleniyor…")
    _post("/ptt/stop")


def _callback(proxy, type_, event, refcon):  # noqa: ANN001
    global _first_event_seen
    try:
        # macOS bazen tap'i devre dışı bırakır (timeout/user-input) — yeniden aç.
        if type_ in (Quartz.kCGEventTapDisabledByTimeout,
                     Quartz.kCGEventTapDisabledByUserInput):
            print("[ptt] (tap devre dışı kaldı — yeniden açılıyor)", file=sys.stderr)
            if _tap is not None:
                Quartz.CGEventTapEnable(_tap, True)
            return event

        if not _first_event_seen:
            _first_event_seen = True
            print("[ptt] ✓ klavye olayları alınıyor (Accessibility izni TAMAM)")

        kc = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
        if kc != KEYCODE:
            return event

        flags = Quartz.CGEventGetFlags(event)
        mod_ok = (MOD_MASK == 0) or bool(flags & MOD_MASK)
        if DEBUG:
            ev = "DOWN" if type_ == Quartz.kCGEventKeyDown else "UP" if type_ == Quartz.kCGEventKeyUp else str(type_)
            print(f"[ptt:debug] hedef tuş {ev} — {MOD_NAME} basılı mı={mod_ok} flags={hex(flags)}")

        if type_ == Quartz.kCGEventKeyDown:
            if mod_ok:
                _on_down()
                return None  # event'i yut
            return event     # modifier yoksa normal tuş çalışsın
        elif type_ == Quartz.kCGEventKeyUp:
            if _pressed:
                _on_up()
                return None
            return event
    except Exception as e:
        print(f"[ptt] callback hata: {e}", file=sys.stderr)
    return event


def _discover() -> None:
    def cb(proxy, type_, event, refcon):  # noqa: ANN001
        if type_ == Quartz.kCGEventKeyDown:
            kc = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
            print(f"  basılan tuş → keycode {kc}")
        return event
    mask = Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown)
    tap = Quartz.CGEventTapCreate(Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap,
                                  Quartz.kCGEventTapOptionDefault, mask, cb, None)
    if not tap:
        print("[ptt] Accessibility izni gerekiyor (Ayarlar → Erişilebilirlik → Terminal).", file=sys.stderr)
        sys.exit(1)
    src = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    Quartz.CFRunLoopAddSource(Quartz.CFRunLoopGetCurrent(), src, Quartz.kCFRunLoopCommonModes)
    Quartz.CGEventTapEnable(tap, True)
    print("[ptt] keşif modu — bir tuşa bas, keycode'u not al. (Ctrl+C ile çık)")
    Quartz.CFRunLoopRun()


def main() -> None:
    if "--keys" in sys.argv:
        _discover()
        return

    if not _service_up():
        print(f"[ptt] UYARI: voice servisi {VOICE_URL} adresinde yanıt vermiyor.\n"
              f"  Önce çalıştır:  python3 -m voice.service", file=sys.stderr)

    global _tap
    mask = (Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown)
            | Quartz.CGEventMaskBit(Quartz.kCGEventKeyUp))
    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionDefault, mask, _callback, None,
    )
    _tap = tap
    if not tap:
        print(
            "\n[ptt] HATA: event tap kurulamadı — Accessibility izni YOK.\n"
            "  Ayarlar → Gizlilik ve Güvenlik → Erişilebilirlik → '+' ile\n"
            "  Terminal'i (veya iTerm/hangi uygulamadaysan) ekle ve İŞARETLE,\n"
            "  sonra bu script'i KAPATIP yeniden başlat.\n", file=sys.stderr,
        )
        sys.exit(1)

    src = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    Quartz.CFRunLoopAddSource(Quartz.CFRunLoopGetCurrent(), src, Quartz.kCFRunLoopCommonModes)
    Quartz.CGEventTapEnable(tap, True)

    mod = {"option": "⌥", "control": "⌃", "command": "⌘", "shift": "⇧"}.get(MOD_NAME, MOD_NAME) if MOD_MASK else ""
    _names = {0: "A", 1: "S", 13: "W", 12: "Q", 49: "Space", 50: "<"}
    keyname = _names.get(KEYCODE, f"keycode {KEYCODE}")
    chord = (mod + " + " if mod else "") + keyname
    print(f"[ptt] hazır — {chord} BASILI TUT konuş, BIRAK. (Ctrl+C ile çık)")
    print("[ptt] (bir tuşa basınca 'klavye olayları alınıyor' yazısını görmelisin)")
    Quartz.CFRunLoopRun()


if __name__ == "__main__":
    main()
