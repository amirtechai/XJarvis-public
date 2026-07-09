# Wake-word keywords

Place your trained Picovoice Porcupine `.ppn` file here.

## Generating "Selam Jarvis"

1. Sign in at https://console.picovoice.ai/
2. Go to **Wake Word** → **Train Wake Word**
3. Type: `Selam Jarvis`
4. Language: `Turkish (TR)`
5. Platform: `macOS (ARM64)` (or `macOS (x86_64)` for Intel)
6. Train and download the `.ppn` file
7. Save it here as `selam_jarvis.ppn`

## Environment variables

Set in `backend/.env`:

```
PICOVOICE_ACCESS_KEY=your-access-key-from-picovoice-console
WAKE_WORD_PATH=~/XJarvis/voice/keywords/selam_jarvis.ppn
```

If `WAKE_WORD_PATH` is omitted, the service uses the default location above.

Until both the access key and the `.ppn` file are in place, the wake-word
service starts but logs a warning and skips activation. Frontend voice
(`/mobile`) keeps working independently.
