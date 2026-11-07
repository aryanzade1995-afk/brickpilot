# Window curtains

Choose **Finishes & Cost → Window curtains & blinds**. This dedicated section includes an interactive 3D preview directly on the page. Apply a style to the whole home or selected rooms. Choices are none, sheer, linen, blackout and roller blind. Cards show labelled illustrations, and the 3D option preview uses the same geometry and motion as the walkthrough.

In the walkthrough, face a nearby window and press **C** to open or close its curtain. **E** continues to operate doors. A labelled curtain button also appears near an eligible window. The walkthrough page has no separate curtain-control panel; styles and previews are kept in Finishes & Cost. Curtains start open. Open/closed states are temporary; material/style preferences survive reload through the existing Brief specifications.

Curtains attach to actual source windows, are limited to the host wall, stop above the finished floor and leave adjacent doors clear. Wet rooms, kitchens and service spaces are excluded. The house, windows, furniture and walking collision geometry remain unchanged. Existing static furnished cutaway curtains remain separate from this walkthrough feature.

Pleats are constructed once; opening animates mesh scale and translation rather than rebuilding buffers. Roller blinds change their drop and hem position. Reduced-motion preferences switch immediately. Animation settles and stops invalidating idle frames; the house shadow maps update once at rest rather than on every animation frame. The geometry has no external model/texture download dependency.

Pricing uses installed coverage **track width × drop** per real window. Fabric fullness, track and fitting are included once in the provisional installed-area allowance. These prices are internal concept allowances, not sourced supplier quotations. General interiors allowances explicitly exclude these separately measured curtains. Room overrides, no-curtain choices and construction/interior scope filters use the existing specification and costing pipeline.

Changing curtains does not invalidate the accepted Blender model: they are a live walkthrough layer, not part of the downloaded building-only GLB. The source building and its render seed remain intact.

Checks: `node --experimental-strip-types --test scripts/test-window-curtains.mjs scripts/test-specs-data.mjs scripts/test-furnished-match.mjs scripts/test-walkthrough-access.mjs`.
