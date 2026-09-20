# System voices in Alder 0.12

Alder discovers optional system voices once at application startup. There is no
Refresh voices button. Restart Alder after adding/removing an operating-system
voice or installing a Linux engine. Renames, hiding and restoring voices update
the library immediately without rescanning the operating system.

Voice names and custom aliases remain intact. Language badges and reading choices
use familiar labels: en-US is American, en-GB is English, en-AU is Australian,
en-CA is Canadian, and en-GB-scotland is Scottish. Other language tags use readable
language names, with regional labels where appropriate. Native IDs and locale
codes remain unchanged in stored data.

Chatterbox's built-in and reference voices carry an AI badge and appear in the AI
reading group. The built-in voice is named Default unless given a custom alias.

## Providers

| Provider | Discovery and rendering | Availability |
| --- | --- | --- |
| Windows SAPI | Existing System.Speech host; enabled installed voices, WAV and word events | Existing Windows functionality preserved |
| macOS | AVSpeechSynthesizer through a private PyObjC worker; Apple voice identifiers, audio buffers and synthesis markers | Implementation included; native acceptance pending |
| Linux eSpeak NG | Installed libespeak-ng and voice data; native enumeration and PCM/event callbacks in a private worker | Exercised on Ubuntu 24.04 under WSL |

Chatterbox/reference voices are independent. Missing optional system voices do not
prevent the app from starting. Linux support currently covers eSpeak NG's exposed
voices, not every engine accessible through Speech Dispatcher. Additional engines
need rendering adapters before they can participate in Alder exports and timing.

On Debian/Ubuntu, the optional runtime is supplied by libespeak-ng1 and
espeak-ng-data (the espeak-ng package also brings in its runtime dependencies).
Use the native distribution's packages for other Linux systems. Alder neither
installs these automatically nor changes desktop speech settings. Diagnostic
overrides ALDER_ESPEAK_LIBRARY and ALDER_ESPEAK_DATA_DIR select an explicit library
and the **parent** directory containing espeak-ng-data; they are not needed for a
normal system installation. No library or voice files are copied into projects.

## Rendering, controls and following

All providers feed Alder's chunked audio player and existing export path. New
native audio is normalized with bundled FFmpeg to mono 24 kHz 16-bit PCM. Preview,
reading, pause/seek, WAV/MP3/FLAC exports and pronunciation mapping use the same
audio pipeline. Native engines do not launch Chatterbox or recognition workers
when usable native timing events are available.

System voice controls appear for a selected system voice. Rate and pitch use a
relative -10 to 10 range, volume 0 to 100. Windows retains its existing rate and
semitone pitch behavior; Apple maps pitch to a multiplier; eSpeak maps it to its
engine pitch range. Equal settings are not a promise of equal acoustic results.
Synthesis changes take effect on the next reading and affect exported audio.
Playback speed and listening volume remain separate transport settings. Existing
sapiRate/sapiPitch/sapiVolume requests remain readable; neutral rate/pitch/volume
fields take precedence when provided.

Native events describe synthesized source positions, not an independent
transcription. Job metadata records this distinction. Native timing adapters
validate bounds/order and map through the pronunciation rules to the original
written text. Where native timings are absent, English recognition may supply
alignment. Other languages never silently use the English recognizer: normal
reading can continue with passage following and a warning; strict checking fails
with an actionable explanation. Speech-duration integrity checks account for
languages that do not consistently delimit words with spaces.

The new workers are serialized and persistent, with bounded requests, cancellation
and restart after failure. Cancellation of a new native render terminates only
Alder's worker and removes incomplete temporary audio. SAPI retains its existing
bounded host/request behavior. Audio cache identity includes provider/voice revision
and timing version. eSpeak's data fingerprint changes when its voice data changes;
macOS exposes an OS version and native voice identity, but does not provide a
complete public revision number for every downloaded voice asset.

## Portability and compatibility

Projects retain their selected voice IDs when a voice is unavailable. The reader
shows a missing choice and asks for an available replacement when synthesis is
requested; it does not silently rewrite an assignment. Replacement through the
reader changes the selected chapter, while voice-specific pronunciation rules
remain unchanged. Already generated audio remains playable when a voice disappears.

Portable .alder archives carry descriptive system-voices.json metadata protected
by the existing manifest hashes. They do not include OS voice binaries. Reference
recordings are collected as before. Unknown/unavailable system voices can be saved
and reopened on another platform without being mistaken for missing reference
recordings. Library aliases and hidden preferences are local to that installation.
Hide never uninstalls a voice; Hidden voices offers Restore.

Existing SAPI IDs and project schema 1 are retained. An older Alder build can read
the project format but cannot synthesize new Mac/Linux provider IDs, and its archive
writer may treat them as missing reference recordings. Choose compatible voices
before editing/collecting such projects in an older build. App rollback is not a
promise of feature parity or a reason to overwrite newer user data.

## Packaging

The Mac helper uses the existing private core Python interpreter instead of a
separately compiled Swift executable. Six PyObjC dependencies are pinned in both
Mac core locks. resources/manifests/macos-system-voices.json records their published
CPython 3.11 universal2 wheels and SHA-256 digests; both architectures use those
wheels. The normal setup hash/cache/offline mechanisms apply. The wheels retain
their package license metadata. Windows/Linux locks and package.json's release
version are unchanged.

Setup doctor reports the optional provider, and installed capability checks invoke
scripts/verify-system-voices.py from the private interpreter. Missing optional
Linux speech is reported as unavailable, not a successful voice test. A broken
Mac bridge or failed detected-provider render fails verification. These checks
do not replace graphical installed acceptance or human listening review.

## Validation recorded on 20 September 2026

- Windows: 304 backend/setup tests passed (3 platform skips), 68 frontend tests and the production build passed. Real SAPI discovery,
  six native renders, word events and WAV/MP3/FLAC pipeline exports passed. The
  Electron voice-library test passed in an isolated external development workspace.
- Linux: Ubuntu 24.04/WSL, eSpeak NG 1.51 from Ubuntu packages extracted into isolated
  temporary storage. Six native renders and English/French/Mandarin pipeline jobs
  passed, including word following and all three audio exports. Cancellation and
  worker restart passed. This is not a cold installed Linux desktop acceptance run.
- Mac: all six pinned universal2 wheel downloads and hashes were checked. The
  provider source is included, but actual discovery/rendering, marker offsets,
  installed signing/runtime behavior, Apple Silicon and Intel execution, and
  human listening remain **pending**. No Mac was available; the user explicitly
  requested recording native Mac validation as pending. Intel Mac remains
  experimental under the existing setup policy.

Maintainers can run the native verifier with --output pointing to an external
directory, --ffmpeg pointing to the bundled converter, --require-voices on a native
acceptance machine, and --pipeline for actual narration/export/cancellation checks.
It writes JSON reports and audio only to the selected test storage. Reports never
claim human listening approval. Use normal setup/update runbooks for end-user
deployment; these source changes have not updated the user's managed installation.

API references: [Apple voice discovery](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices()),
[Apple buffers and markers](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:tomarkercallback:)),
[eSpeak NG retrieval API](https://github.com/espeak-ng/espeak-ng/blob/master/src/include/espeak-ng/speak_lib.h),
[PyObjC AVFoundation](https://pypi.org/project/pyobjc-framework-AVFoundation/12.2.2/).
