# XJarvis iOS Companion

This directory will hold the SwiftUI iOS companion app. The full app is
multi-week work; **this README is the roadmap and the immediate
"works today" alternative.**

## What works *today* on iPhone (no native app needed)

XJarvis is fully reachable from your iPhone via the Telegram bridge:

- Send any message to your XJarvis bot → it gets routed to the agent →
  reply comes back as a Telegram message.
- Voice notes work (Whisper transcribes them server-side).
- Photos attached to a message are processed by the vision tool.
- Heartbeat / morning brief / meeting brief / insights all push to
  Telegram, so notifications, do-not-disturb, and Apple Watch glances
  all "just work" via the Telegram app.

For most users that is enough. The native app is nice-to-have, not
critical.

## Faster middle-ground: iOS Shortcuts

Apple Shortcuts can hit XJarvis HTTP endpoints directly. A typical
"Hey Siri, JARVIS …" flow:

1. Open the **Shortcuts** app on iPhone.
2. New Shortcut → "Get Contents of URL":
   - URL: `http://<your-mac.local>:3001/api/agent/ask`
   - Method: `POST`
   - Headers: `Content-Type: application/json`
   - Body (JSON): `{ "prompt": "<<Dictated Text>>" }`
3. Speak action: read the response back to the user.
4. Add to Siri: "Hey Siri, JARVIS".

For this to work over cellular you need the Mac reachable — Tailscale or
a tunnel (`cloudflared tunnel`) is the easy path. Localhost-only is fine
on the same Wi-Fi.

## Native app — planned milestones

When time permits, the native SwiftUI app will be built in this directory.

### M1 — chat MVP
- WebSocket client to `ws://primary.local:3001` (with bearer token reuse
  from `XJARVIS_SYNC_TOKEN`)
- Live transcript view (RESPONSE_CHUNK events)
- Message composer (text + push-to-talk via `SFSpeechRecognizer`)

### M2 — push notifications
- APNs via the existing Heartbeat module — primary backend POSTs to
  Apple Push Service when an "action=notify" decision arrives.
- Ship a small notification service extension so the app can show
  rich previews and quick actions ("approve email draft", "snooze").

### M3 — Watch widget
- Single complication: latest heartbeat summary + recovery score.
- Accessory rectangular (`.accessoryRectangular`) layout.

### M4 — vision share extension
- Long-press any image / link in another app → "Send to JARVIS"
  posts it to `/api/agent/ask` with the image attached.

## Repo layout (when building starts)

```
ios/
├── XJarvis.xcodeproj
├── XJarvisApp/          # SwiftUI app target
├── XJarvisWatch/        # watchOS extension
├── XJarvisShare/        # share extension
└── XJarvisCore/         # shared Swift package — WS client, types
```

## Open questions
- Do we need a TestFlight track or is sideloading via Xcode enough?
- What auth model — reuse the multi-machine sync token, or pair the
  device via QR code?
- Does the iOS app run a local agent (MLX) or stay thin and rely on
  the Mac?
