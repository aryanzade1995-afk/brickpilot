# Drawing Digitizer Adapter Guide (Option 2: "Start From My Plan")

BrickPilot’s **Start From My Plan** pipeline is built on a pluggable, provider-agnostic digitization architecture. It allows any drawing recognition engine (cloud vision model, local ONNX, custom vectorizer, or rule-based parser) to ingest floor plans without modifying any UI components or downstream engines.

---

## Architecture Overview

```
User Drawing (PNG / JPEG / WebP)
          │
          ▼
   [ DrawingDigitizer ] ──(Registry)──► [ ManualTraceDigitizer ] (Default Fallback)
          │
          ▼
     [ RawSurvey ]
   • Image-space pixel coordinates (px)
   • Per-element confidence scores (0.0 to 1.0)
   • Rooms, walls, doors, windows, dimensions
          │
          ▼
   [ Interactive Reviewer & Calibration ] (Human-in-the-Loop)
          │
          ▼
   [ Construction Snapping & NBC Health Check ]
          │
          ▼
   [ useStudio.getState().loadExisting(brief, structure) ]
          │
          ▼
   Downstream Engine: 2D Plan, 3D Massing, Finishes/BOQ, Social Impact, Report
```

---

## 1. The `DrawingDigitizer` Interface

Located in `src/lib/existing/digitizer.ts`:

```typescript
export interface DrawingDigitizer {
  id: string
  name: string
  description?: string
  digitize(image: File | Blob, opts?: DigitizeOptions): Promise<RawSurvey>
}

export interface DigitizeOptions {
  signal?: AbortSignal
  timeoutMs?: number
  expectedPlotWidthM?: number
  expectedPlotDepthM?: number
}
```

### The `RawSurvey` Contract

Every adapter returns elements positioned in **image-space pixels**, each tagged with a `confidence` between `0.0` and `1.0`:

```typescript
export interface RawSurvey {
  imageWidth: number
  imageHeight: number
  elements: {
    rooms: RawSurveyRoom[]       // { id, name, type, box: { x, y, w, h }, confidence }
    walls: RawSurveyWall[]       // { id, a: { x, y }, b: { x, y }, kind: 'exterior' | 'interior', confidence }
    openings: RawSurveyOpening[] // { id, kind: 'door' | 'window' | 'entry', orient: 'h' | 'v', at: { x, y }, widthPx, swing, confidence }
    dimensions: RawSurveyDimension[] // { id, text, a: { x, y }, b: { x, y }, confidence }
  }
  scaleMPerPx?: number          // Optional inferred scale (metres per pixel)
  metadata?: {
    adapterId: string
    timestamp: number
    notes?: string[]
  }
}
```

Items with `confidence < 0.7` are automatically surfaced in the **"Needs Review"** side panel in the interactive CAD reviewer.

---

## 2. Writing a Custom Adapter

Here is a complete example of a custom digitizer adapter calling a vision service:

```typescript
import {
  type DrawingDigitizer,
  type RawSurvey,
  type DigitizeOptions,
  registerDigitizer,
} from '@/lib/existing/digitizer.ts'

export class CustomAiDigitizer implements DrawingDigitizer {
  public readonly id = 'custom-ai-extractor'
  public readonly name = 'Custom AI Plan Extractor'
  public readonly description = 'Detects rooms, walls, and door swings using custom AI.'

  async digitize(image: File | Blob, opts?: DigitizeOptions): Promise<RawSurvey> {
    const formData = new FormData()
    formData.append('plan', image)

    const response = await fetch('/api/custom-digitize', {
      method: 'POST',
      body: formData,
      signal: opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? 25000),
    })

    if (!response.ok) {
      throw new Error(`Extraction service returned HTTP ${response.status}`)
    }

    const payload = await response.json()

    return {
      imageWidth: payload.width,
      imageHeight: payload.height,
      elements: {
        rooms: payload.rooms.map((r: any, idx: number) => ({
          id: `room-${idx + 1}`,
          name: r.label,
          type: r.category ?? 'living',
          box: { x: r.x, y: r.y, w: r.width, h: r.height },
          confidence: r.score ?? 0.85,
        })),
        walls: payload.walls.map((w: any, idx: number) => ({
          id: `wall-${idx + 1}`,
          a: { x: w.x1, y: w.y1 },
          b: { x: w.x2, y: w.y2 },
          kind: w.isExterior ? 'exterior' : 'interior',
          confidence: w.score ?? 0.9,
        })),
        openings: payload.openings.map((o: any, idx: number) => ({
          id: `opening-${idx + 1}`,
          kind: o.type === 'window' ? 'window' : o.isMainEntry ? 'entry' : 'door',
          orient: Math.abs(o.x2 - o.x1) > Math.abs(o.y2 - o.y1) ? 'h' : 'v',
          at: { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 },
          widthPx: Math.hypot(o.x2 - o.x1, o.y2 - o.y1),
          swing: o.swingDirection ?? 1,
          confidence: o.score ?? 0.8,
        })),
        dimensions: [],
      },
      metadata: {
        adapterId: this.id,
        timestamp: Date.now(),
      },
    }
  }
}
```

---

## 3. Registering Your Adapter

Register your adapter at app initialization or inside your module:

```typescript
import { registerDigitizer } from '@/lib/existing/digitizer.ts'
import { CustomAiDigitizer } from './CustomAiDigitizer.ts'

registerDigitizer(new CustomAiDigitizer())
```

Once registered, the ingestion pipeline automatically uses your adapter. If your adapter throws an error, encounters a network timeout, or returns invalid data, the system automatically falls back to `ManualTraceDigitizer`, allowing the user to trace on the overlay without disruption or dead ends.

