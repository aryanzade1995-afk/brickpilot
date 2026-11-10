# Local interior AI

AI Interior has a local **Generate AI room view** action. Generate the regular 360° preview first, face the desired view, then request the AI concept. The current perspective image, selected room, style, lighting, furniture density and finishes condition a local RealVisXL Lightning img2img workflow.

The installed RTX 3050 6 GB was verified through NVIDIA and ComfyUI. A real smoke render completed at 3840 × 2160 in approximately 65 seconds on its first run. Diffusion runs at 1024 × 576 with tiled VAE and the result is resized to 4K; the UI labels it an upscaled AI still. This does not create navigable geometry or guarantee matching architecture.

The existing walkthrough uses its real house geometry. Graphics defaults to **2K · 1440p · 60 FPS target** (2560 × 1440). **4K target · adaptive** is also available. Both preserve the display aspect ratio and target the corresponding pixel budget (capped at 8× pixel ratio) with a 60 FPS budget. On a 16:9 display these correspond to 2560 × 1440 and 3840 × 2160; portrait displays use the same pixel budget without letterboxing. It reduces resolution when measured FPS falls below budget. Actual resolution and timing appear in View settings and the performance report. It is not a guaranteed 4K/60 FPS benchmark or a generated walkthrough video.

`npm run dev` reuses a running ComfyUI or starts the installed Windows portable runtime at `%USERPROFILE%/ComfyUI_windows_portable`. Override the installation using `COMFYUI_HOME`. The installed checkpoint is `RealVisXL_V5.0_Lightning_fp16.safetensors`; `SDXL_CKPT` can override it. `COMFYUI_URL` defaults to loopback port 8188. No model files are downloaded automatically. An unavailable local service remains explicit in the interface.

Bathrooms are combined by default. Brief → Rooms → Bathroom & toilet arrangement can request separate wet rooms. Empty bathroom counts produce one required shared bathroom. Separate rooms have separate doors, plumbing fixtures and sanitary quantities; an existing measured house is not automatically remodelled.
