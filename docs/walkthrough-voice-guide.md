# Room narration and design insights

The walkthrough automatically describes each stable room entry. There is no
question box, microphone prompt or chat panel. Marathi is the default narration
language; English and Hindi use available browser voices. The compact control
supports mute, language selection and replay (V). Escape stops audio and retains
the existing return-to-orbit behavior. The room name, purpose, source-plan
proportions and selected flooring/wall palette form the description. Unknown
measurements or products are never invented.

One notification in the top-right proposes a specific design improvement. It
shows the room, suggestion, proposed palette, reason and an optional link to the
correct room in Finishes & Cost. Closing the notification never changes the
house. Reviewing finishes exits walking normally before navigation.

## Local Hugging Face models

Run `npm run room-ai:prepare` once. Downloads are pinned to recorded revisions;
model weights and voicepack are SHA-256 checked. Interrupted downloads resume.
The command needs approximately 350 MB for active model files, plus temporary
and cache space. No token or paid inference endpoint is needed.

- [Marathi Kokoro voice](https://huggingface.co/shreyask/bol-tts-marathi-onnx),
  Asha voicepack, Apache-2.0: produces Marathi WAV audio without an installed
  Marathi system voice. First synthesis takes a moment; generated room audio is
  cached. One source-recorded entrance is prepared while the orbit view is open.
- [MiniLM semantic embeddings](https://huggingface.co/Xenova/all-MiniLM-L6-v2),
  Apache-2.0: ranks curated interior proposals against room dimensions and the
  existing finish selections. This is text-based semantic recommendation
  ranking, not image analysis or engineering validation. The model cannot
  invent a product, price, link or geometry. If inference fails, the specific
  rule-based proposal stays available and loses its AI label.

Both models run server-side, in a separate worker, on CPU with two inference
threads. The walkthrough GPU, canvas, accepted GLB, physics, finishes and costs
are not rebuilt. Marathi text-to-IPA uses the eSpeak NG Marathi language data;
see public/room-ai/ATTRIBUTION.txt for package licenses and source links.

Browser audio is unlocked from the existing Walk inside click, or Replay. No
microphone is used. Audio fetches, late decoding and playing sources are
cancelled on room/finish/language changes, mute, hidden page, exit or unmount.
A generation already running server-side may finish into its bounded queue/cache,
but its result cannot play in a different room. Cache identity includes source
plan, room, description, narrator and model revision. Customer details, addresses,
raw meshes and prices are not sent to model providers; inference is local after
setup.

Endpoints: POST /api/walkthrough-room (description and insight), POST
/api/walkthrough-room/audio (cached Marathi audio identity), GET
/api/walkthrough-room/audio/<hash>.wav. The previous question API remains only
for compatibility and is not exposed in the walkthrough UI.

Validation: `npm run test:room-experience`, `npm run test:walkthrough-guide`,
existing navigation/finish regression tests, and `node --experimental-strip-types
scripts/check-room-ai-live.mjs` for actual local ranking and waveform checks.
