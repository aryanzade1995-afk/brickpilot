# First-person house walkthrough

AI Interior → Generate walkthrough assets → Review exported model → **Walk inside**.
The existing orbit canvas becomes the first-person view. **Escape** releases the
mouse and returns to orbit; **Return to 3D view** does the same. The character's
position is retained when switching modes. There is no floor-selection teleport.

## Implementation

- `src/lib/walkthrough/navigation.ts`: pinned `@dimforge/rapier3d-compat@0.21.0`,
  one WASM initialization promise, validated delivery data, static source boxes,
  furniture colliders, source-linked door bodies and kinematic capsule movement.
  This module runs identically in the browser and the Node/WASM physics tests.
- `src/components/interior/FirstPersonController.tsx`: R3F frame integration,
  native pointer lock, WASD input, mouse look, E interaction, camera/door visual
  transforms, floor/room HUD and restoration of the orbit camera and controls.
- `src/components/interior/WalkthroughAssetPreview.tsx`: shared canvas, collision
  package loading, safe preparation/error states, Walk/Return buttons, floor
  cutaways outside walking mode, and English/Hindi/Marathi UI.
- `scene.ts` / `sceneTypes.ts`: preserve optional source door hinge, swing and
  emergency-exit fields in exported metadata. No planner or building identity
  logic is changed. Regenerate old assets to get these extra source fields.
- `scripts/test-walkthrough-navigation.mjs`: actual Rapier/WASM movement tests.

Uses the official [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)
for swept collision/slide queries, bounded stair stepping and ground contact.
The integration is direct inside R3F, so it shares the existing Three version and
does not introduce a second physics/render provider, canvas or external service.
The compatibility package embeds WASM and is loaded with the lazy model viewer.

## Movement and camera

| Setting | Value |
| --- | --- |
| Capsule | 0.22m radius, 1.75m total height |
| Eye | 1.62m above feet |
| Walking speed | 1.65m/s; normalized diagonal input |
| Integration | Fixed 60Hz; maximum six catch-up steps / 0.1s frame |
| Acceleration/deceleration | Exponential, 12/s and 18/s |
| Skin margin | 0.008m |
| Stair step / ground snap | 0.23m / 0.24m |
| Slope limit | 45° climb, approximately 46.8° slide threshold |
| Camera near / FOV | 0.035m / 72° in first person; previous values restored on exit |

Mouse look has unrestricted horizontal rotation and a near-vertical pitch limit
to prevent camera inversion. Camera X/Z follow the collision capsule exactly;
only eye elevation eases across individual treads, clamped inside the body-height
envelope. No camera spring is permitted to trail behind a wall. There is no jump,
flight, crouch, speed boost, gravity-free floor transition or automatic respawn.

Source solids for **all** floors remain in the same physics world. No active-floor
filter hides ceilings or upper stair waists. Autostepping is enabled only near the
delivered source stair region, including its approach/landing. No collision ramp,
invisible stair bridge or replacement landing is added. Tests walk the actual
source tread boxes around the dog-leg landing and onto the retained upper slab.

Ground probes reject unsupported displacements at courtyard, shaft, stairwell and
terrace edges. If support becomes unexpectedly unavailable, movement pauses with
a message; it does not relocate the character. This precaution does not add or
claim a physical guard or certify safe building construction.

## Entry and doors

The initial spawn uses the delivered **main** entrance, not the first sorted
emergency exit. It is rechecked with the actual 1.75m capsule against structure,
closed doors, frames and current furniture, with a support probe below the feet.
A missing/blocked main entry disables walking and leaves the orbit model usable.
No arbitrary room centre is selected as a fallback.

Point at a source door within 2m and press **E**. A ray checks intervening walls
and furniture. Closed leaves remain physical. When hinge/swing details are
explicit, the leaf and its collider share the same pivot rotation; explicit
sliding doors share a translation. Visual transforms are conjugated through the
real GLB parent matrix instead of assuming an identity root. Door colliders refresh
the broad phase before character movement. A closing/opening leaf pauses if its
next position would intersect the character, avoiding trapping or camera pushing.

Older or incomplete source records may have no hinge/swing. Those leaves are
hidden/disabled only in their explicit open state, with a visible qualification;
the source aperture stays fixed. A hinge/pocket mechanism is not invented. Door
states are temporary viewer state and do not edit the plan, render or estimate.
Furniture uses the delivery pipeline's conservative AABBs, so some rotated or
rounded pieces reserve slightly more space than their visible surface.

## Lifecycle and performance

Pointer lock starts only from the user's Walk button gesture. Escape, loss of
focus, hidden documents, viewer closure and component cleanup clear held keys and
stop movement. Lock denial shows a retry message and an explicit **Use drag-look
mode** button. This fallback shares the character, camera and collision simulation;
look changes while the left mouse button is held, and Escape/Return work normally.
The embedded browser used in verification rejected capture with Chromium's
`UnknownError`; drag-look, real WASD movement and Escape were verified there.
Native pointer-lock operation remains implemented for supporting browsers; its
successful capture could not be verified in that embedded host. Desktop keyboard/mouse movement is
implemented; a mobile walking joystick is not part of this stage.

The camera's previous orbit position, target, projection and clipping are restored
when walking ends. Cutaway planes are cleared during first-person movement. DPR
stays capped at 1.5, existing material/mesh batches are reused, and no expensive
screen effects or new shadow passes are introduced. Only active walking requests
continuous frames; the viewer otherwise keeps demand rendering.
HUD updates are throttled, and static door transforms are skipped. Physics worlds,
event handlers, held input, model assets and pointer locks have explicit cleanup.

The WASM test reports CPU physics timing for a planner-generated furnished house;
it is a local smoke measurement, not a measured RTX 3050 GPU frame-rate guarantee.

## Validation

```
npm run test:walkthrough-navigation
npm run test:walkthrough
$env:WALKTHROUGH_BLENDER_TEST='1'
npm run test:walkthrough-assets
npm run build
```

Movement cases include main-entry identity and grounding; stale/corrupt data;
acceleration, stopping, diagonal normalization and frame-rate independence; a
closed/open 600mm door and blocked 400mm opening; no door closure onto the person;
source dog-leg stairs in N/S/E/W orientations, each up and down through the landing
and floor transition with bounded vertical displacement; walls/furniture; low
headroom; unsupported edges; and an isolated slope-controller test. The latter
does not add sloping surfaces to any real exported house. Source geometry and
asset-delivery regression tests remain separate from movement tests.

Missing balcony/stair guard geometry, unspecified roof headroom enclosures,
decorative ceiling details and other source limitations remain in export review
notes. Walking does not silently repair, remove or ignore architectural obstacles.
