# Voice Swap for Audiobooks and Podcasts: Landscape and Scope

Date: 2026-09-08

## 1. The question

Does an app exist that takes podcast or audiobook audio from popular listening apps
(Audible, Spotify, Apple Podcasts, Pocket Casts, etc.), reroutes it, and replaces the
narrator's voice with one the listener picks from a menu?

## 2. Short answer

No. Nothing on the market does this end to end. The pieces exist separately, but nobody
has combined "capture another app's playback" with "neural voice conversion" for
listeners, and on phones the platforms actively prevent the capture half.

### What exists today (and why each falls short)

| Product / project | What it does | Gap versus the ask |
|---|---|---|
| ElevenLabs Voice Changer, Voicemod, Dubbing AI, Voice.ai | Real-time speech-to-speech voice conversion, ~400 ms on ElevenLabs | Built around the microphone (games, calls, streaming). They do not capture playback from other apps. Cloud pricing is $0.12/min, too high for 10-hour books. |
| ElevenReader, Speechify | Let the listener pick from hundreds of voices | Text-to-speech readers. They need the text, not another app's audio. They cannot touch Audible or Spotify playback. |
| Audible AI narration, Spotify x ElevenLabs audiobook tool (May 2026) | Publishers and authors pick an AI voice at production time | Publisher-side only. Listeners still cannot switch narrator on a purchased title. Audible's only listener-facing angle is a consented narrator voice-replica program. |
| Wavelet (Android) | Applies DSP (EQ, dynamics) to other apps' audio sessions without root | Proves the "process another app's audio" pattern on Android, but it is simple DSP, not neural conversion, and it only attaches to apps that expose an audio session. |
| Seed-VC, RVC, LLVC, StreamVC (open source) | Zero-shot or few-shot voice conversion. Seed-VC tiny model: 25M params, ~430 ms end-to-end on an RTX 3060 laptop GPU. LLVC runs faster than real time on CPU. | Research and hobbyist tooling. No consumer product, no app-capture layer. Seed-VC is GPL-3.0, RVC is MIT. |

## 3. Why it does not exist: the four blockers

### 3.1 Platform audio capture

| Platform | Can a third-party app capture another app's playback? | Can it silence the original so the listener hears only the converted voice? |
|---|---|---|
| iOS / iPadOS | No public API. ReplayKit broadcast extensions get app audio for screen recording, but cannot re-inject it into live playback and would not pass App Review for this use. | No |
| Android 10+ | Yes, AudioPlaybackCapture, with a screen-capture consent prompt and RECORD_AUDIO. But the source app decides: Spotify, Audible, and other DRM apps set `allowAudioPlaybackCapture="false"`, so capture yields silence. Most podcast apps (no DRM) leave capture allowed. | No. The source keeps playing. There is no non-root way to mute one app while capturing it. |
| macOS 14.2+ | Yes, Core Audio process taps (`CATapDescription` + `AudioHardwareCreateProcessTap`). Requires the System Audio Recording permission. | Yes. Taps support a mute-when-tapped behavior, so the original can be silenced while the converted stream plays. (Confirm in the spike.) |
| Windows 10 build 20348+ / 11 | Yes, per-process WASAPI loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`). | Partially. Loopback does not mute the source; the app would need to lower the source's volume via the per-app mixer, which is workable. |

Net: the "reroute from any app" idea is only cleanly possible on desktop. On Android it
works for podcasts but not for Audible or Spotify, and the original audio keeps playing.
On iPhone it is not possible at all.

### 3.2 Legal exposure

- **DRM circumvention (DMCA 1201).** Audible and Spotify audiobooks are DRM-protected.
  Capturing decoded PCM from a system tap is arguably not circumvention of the DRM
  itself, but both services' terms prohibit capturing, modifying, or re-recording content.
  Shipping a tool whose headline feature is "works with Audible" invites a takedown or
  trafficking claim even if individual home use might be defensible.
- **Podcasts are different.** Podcasts are DRM-free MP3s served over open RSS. Capturing
  or downloading them for personal transformation carries far less risk.
- **Derivative work.** Re-voicing a narrated performance creates a derivative of a
  copyrighted recording. For private listening this is low risk. For any sharing or
  storage in the cloud it is not.
- **Voice likeness.** Offer only voices you own or license (synthetic or consented
  actors). No celebrity or "sounds like" clones. State laws such as Tennessee's ELVIS Act
  and the federal NO FAKES proposals make unlicensed likeness a real liability.

### 3.3 Cost of conversion

| Backend | Cost per hour of audio | Notes |
|---|---|---|
| ElevenLabs Voice Changer API | ~$7.20 (at $0.12/min) | A 10-hour audiobook costs ~$72. Not viable for a consumer subscription. |
| Self-hosted Seed-VC / RVC on a cloud GPU (L4-class, ~$0.70/hr) | ~$0.05 to $0.15 | Assumes 5x to 15x real-time batch throughput. Needs verification in the spike. |
| On-device (Apple Silicon, desktop GPU) | ~$0 | Seed-VC tiny already runs faster than real time on a laptop GPU. Phone NPUs are plausible for a distilled model but that is real engineering work. |

Cloud API pricing kills the naive build. Local or self-hosted inference is required.

### 3.4 Quality on long-form, multi-speaker audio

- Single-narrator audiobooks are the easy case: one voice in, one voice out, and the
  original prosody is preserved by conversion models.
- Podcasts have two to five speakers plus music beds and ads. That needs speaker
  diarization (who is talking when), a per-speaker voice mapping, and pass-through of
  non-speech. Diarization errors show up as voices flickering mid-sentence.
- Latency is not the hard constraint people assume. For playback (unlike a live call)
  the app can buffer several seconds. What matters is throughput at or above 1x real time.

## 4. Recommended product shape

Build the product around **a player you control plus a conversion pipeline**, and offer
desktop "capture any app" as a power-user mode where the OS allows it. Do not build
around iPhone capture; it cannot be done.

### Tier 1 (core): Voice-swap podcast and audiobook player (iOS, Android, desktop)

- Subscribes to podcast RSS like any podcast app. Episodes are downloaded, converted in
  the background to the chosen voice (or per-speaker voices), and played from local cache.
- Imports DRM-free audiobooks the user already owns (Libro.fm, Downpour, LibriVox, MP3/M4B
  files). Converts chapter by chapter ahead of the playhead.
- Voice picker: 6 to 10 licensed voices at launch, with per-show and per-speaker overrides.
- Conversion runs on-device where the hardware allows (Apple Silicon Macs, recent phones),
  otherwise on a self-hosted GPU service. Never through a per-minute third-party API.
- This tier is legal on its face, works on every platform, and covers the whole podcast
  market plus every DRM-free audiobook.

### Tier 2 (desktop add-on): Capture mode for other apps

- macOS: Core Audio process tap on the selected app (Spotify, Apple Podcasts, browser),
  mute-when-tapped, convert with roughly 1 to 2 seconds of buffer, play out.
- Windows: per-process loopback plus per-app mixer volume duck.
- Ships with a clear notice that it is for personal listening and does not defeat DRM.
  Do not market it as an Audible feature. Consult counsel before naming any service.

### Explicitly out of scope

- iPhone capture of other apps' audio (no API).
- Android capture of Audible or Spotify (they opt out).
- Cloning the original narrator or any real person without a license.

## 5. Phased plan

| Phase | Duration | Deliverable | Exit criteria |
|---|---|---|---|
| 0. Feasibility spike | 2 to 3 weeks | Convert a 1-hour audiobook and a 45-minute two-host podcast with Seed-VC and RVC. Measure throughput, artifacts, diarization accuracy. Prototype a macOS tap with mute. | Listening test: 5 of 8 testers rate converted audiobook "would listen for an hour." Throughput at least 3x real time on target hardware. Tap mutes the source. |
| 1. Desktop MVP (macOS) | 6 to 8 weeks | Menu-bar app: pick app, pick voice, listen. Local inference on Apple Silicon. | Works with Apple Podcasts and a browser stream for a full episode without dropouts. |
| 2. Player app (iOS + Android) | 10 to 12 weeks | Podcast player with background pre-conversion, DRM-free audiobook import, voice picker, cloud fallback for conversion. | Full episode converted before the user finishes the previous one on a mid-range phone or via server. |
| 3. Multi-speaker and voice library | 6 weeks | Diarization, per-speaker mapping, 20+ licensed voices, Windows capture mode. | Two-host podcast converts with under 2 percent speaker-flip errors. |

Team for phases 0 to 2: one ML/audio engineer, one platform engineer (Swift/Kotlin),
a part-time designer, and legal review at phase 0 and before launch.

## 6. Key risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Conversion quality fatigues listeners over hours | Medium | Phase 0 listening test is a hard gate. Offer "subtle" voices close to the original first. |
| Legal challenge from Audible or Spotify over capture mode | Medium if marketed, low if not | Keep capture mode desktop-only, personal-use, unbranded. Lead with the podcast player. |
| Seed-VC GPL-3.0 forces open-sourcing the app | High if linked directly | Use RVC (MIT) or run Seed-VC as a separate server process, or train a proprietary model. |
| Phone on-device inference too slow or hot | Medium | Server fallback from day one. Convert ahead while charging or on Wi-Fi. |
| App Store rejection for background audio capture claims | Low for Tier 1 | Tier 1 uses only standard background-audio entitlements. |

## 7. Sources

- Android AudioPlaybackCapture rules: https://developer.android.com/media/platform/av-capture
- Spotify and DRM apps opt out of capture: https://www.visioforge.com/help/docs/dotnet/general/guides/android-audio-playback-capture/
- iOS cannot access other apps' audio: https://developer.apple.com/forums/tags/replaykit
- macOS Core Audio process taps: https://askcanary.com/glossary/coreaudio-tap/
- Windows process loopback: https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type
- Seed-VC real-time figures and model size: https://github.com/Plachtaa/seed-vc
- RVC (MIT): https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI
- LLVC low-latency CPU conversion: https://arxiv.org/pdf/2311.00873
- StreamVC: https://arxiv.org/pdf/2401.03078
- ElevenLabs voice changer and pricing: https://elevenlabs.io/docs/overview/capabilities/voice-changer , https://elevenlabs.io/pricing/api
- Audible AI narration for publishers: https://www.audible.com/about/newsroom/audible-expands-catalog-with-ai-narration-and-translation-for-publishers
- Spotify ElevenLabs audiobook tool: https://techcrunch.com/2026/05/21/spotify-launches-an-elevenlabs-powered-audiobook-creation-tool/
- Wavelet system-wide audio effects on Android: https://www.xda-developers.com/make-your-headphones-sound-better-automatic-eq-wavelet/
- DMCA 1201 primer: https://iipsj.org/wp-content/uploads/2023/09/Section-1201-Legislative-Primer.pdf
- Why audiobook platforms lack voice change: https://www.audiobooksgeek.com/can-you-change-the-voice-on-audible-explained/
