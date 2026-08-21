# @deepseek-ai/dsh-attachment-local

English | [中文](README.zh.md)

The private local implementation of [`@deepseek-ai/dsh-attachment`](../attachment). Objects land at `<DSH_HOME>/attachments/v1/objects/<sha256-prefix>/<sha256>` and are addressed by an opaque `sha256:` id. Each process proves a home durable once by syncing every ancestor entry to the filesystem root. Writes use a private staging directory, owner-only files, a synced temporary file, an atomic exclusive hard-link publish, and directory syncs on the publication path (POSIX; Windows relies on filesystem metadata journaling) so the reported reference survives a crash.

Admission accepts at most 20 images and 200MiB of encoded source bytes per message. Each source may use up to 20MiB, 64,000,000 pixels, and 8192px per side. It then prepares a provider-independent normalized attachment. EXIF orientation is applied, metadata and color profiles are removed, pixels become 8-bit sRGB/sRGBA, and the long edge is reduced proportionally to `normalizedImageMaxDimension` (2048px by default). The normalized attachment has its own `normalizedImageMaxBytes` safety cap (4MiB by default). Transparent pixels are retained; Sharp/libvips may omit an alpha plane whose samples are all opaque. A nearest-neighbour bounded sample classifies color complexity without averaging high-frequency pixels. Confirmed low-color images try PNG, using a palette only when the input has no alpha channel, then WebP at qualities 85, 80, and 75. Other alpha images try WebP at those qualities; other opaque images try JPEG. Each candidate runs only after the preceding candidate exceeds the cap. Dimensions shrink only after every candidate at one size exceeds the cap. A clean, single-frame 8-bit sRGB/sRGBA PNG, JPEG, or WebP already within both normalization limits passes through byte-identically; 16-bit PNG, GIF, animated input, metadata, orientation, and incompatible color spaces force conversion. The source and converted attachment are each fully decoded once. `saveImages` prepares and verifies every normalized attachment once before publishing the batch, so validation failure leaves no partial references and commit does not repeat full image encoding.

Request versions live below `<DSH_HOME>/attachments/v1/request-images/`. `readImageRequest` scales the stored normalized attachment under a total-pixel budget without enlargement, then enforces a separate encoded-byte cap. The request encoder uses the same color branches, with PNG (palette only without alpha) before WebP 85 and 80 for low-color images, WebP 85 then 80 for other alpha images, and JPEG 85 then 80 for other opaque images. It executes candidates lazily and reduces dimensions only after both quality attempts exceed the request cap. Its cache identity includes the attachment id, transform version, pixel and byte budgets, and fixed encoder settings. Cached bytes are fully decoded and checked as 8-bit sRGB/sRGBA before use. Concurrent calls for one identity share one transform and cache write; cancelling one waiter does not cancel the shared work. Callers compose ordered batches from singular reads, while the service's FIFO limiter applies `imageCompressionConcurrency` to simultaneous normalization and request transforms. The setting ranges from 1 through 8 and defaults to 2; file publication remains ordered after preparation.

`DSH_HOME` resolves through the shared path policy: explicit config, `$DSH_HOME`, then `~/.dsh`. Session logs contain only the reference and verified metadata, never this host path. `readImage` forwards optional cancellation into the filesystem read, observes it around verification, and preserves it instead of wrapping it as `ATTACHMENT_READ_FAILED`.

## Model Experience

Indirectly, through durable replay of historical user images and structured model image output after restart and fork.

#### KV Cache effect

Normalization and request projection are deterministic. An unchanged attachment and route policy reuse identical cached request bytes on later turns.

## Known Limitations and Deferred Work

- Objects are retained indefinitely; reference-aware garbage collection is deferred.
- The local backend assumes the host and provider adapter share this filesystem service.
- Animated GIF sources keep only their first frame; animation is outside the version-one image contract.
- The normalization and request encoders are pinned by the installed sharp/libvips build; an encoder or transform-version upgrade re-addresses future normalized attachments or request variants while existing objects stay valid.
