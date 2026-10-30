# DSH UI components

The actual React component and CSS extracted from the installed, MIT licensed
`@deepseek-ai/dsh-client-ui-chat@0.1.5-rc.2` published bundle (`lib/client.js`).
`TurnNavigator.js` retains the published component body unchanged; its only
additions are standalone imports, the original CSS class map, and an export.
`TurnNavigator.css` is the original decoded CSS string. See `LICENSE`.

Upstream sources:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/chat/TurnNavigator.tsx
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/chat/TurnNavigator.module.css

`bridge.js` provides Blueprint's real turn entries, loaded/unloaded anchors,
current reading turn, history expansion and jump callbacks. It adds keyboard
arrow/Home/End navigation. Workspace placement and neutral color aliases are
scoped in `viewer/stream.css`. The component's marks, hover preview, overflow
scrolling, fading, active following, animations, dimensions and rounded card
come from DSH. Fewer than two turns hides the rail, as in the original.

This is a DSH component, not a copy of proprietary Codex desktop source.

## Trace overview

`trajectory/TrajectoryToolbar.js` and `trajectory/TrajectoryTimeline.js` retain
the published `@deepseek-ai/dsh-client-ui-trajectory@0.1.5-rc.2` component bodies
and CSS class maps unchanged. Their decoded CSS, timeline projection, record
identities, formatting and locale dictionaries are also from that bundle.
`trajectory/provenance.json` records source hashes. `primitives/` contains the
original DSH Tooltip and search SVG from the local reference checkout; esbuild
handles its CSS module. These sources share the MIT license in `LICENSE`.

Upstream components:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx

`trajectory/bridge.js` exports `mountTrace` in the existing browser bundle,
sharing React with the turn navigator. It connects the original toolbar and
three-lane timeline to Blueprint's current-session ledger, including duration
versus equal-width projection, search, turn/call folding, drag focus, range
reset, record inspection and cross-view navigation. DSH owns hover timing,
wheel zoom, right-button panning and selection gestures. A timeline range keeps
the complete ledger and dims outside rows at DSH's original
opacity of 0.24; clicking a ledger row or timeline span clears that range.
Text search filters independently of the timeline's focus range. The adapter searches
Blueprint's full retained record fields and payloads; it does not import DSH's
Markdown search parser or virtualized table. The existing ledger and its
fork/rewind actions remain the host. Dispatched children use the same inherited
history exclusion in both overview and ledger. Session changes reset filters,
selection and folding. Missing timestamps remain missing.

Studio places this overview between the Session branch diagram and Trace
ledger, with neutral surfaces and the original DSH light-theme semantic colors
from `ui-theme/src/styles/design-platform.css`, scoped to the overview. Both navigation and trajectory CSS
are included in the existing `dsh-turn-navigator.css` asset.
Studio adds a pale blue row fill, blue edge and clearer text for focused or
selected ledger records on the light surface, and stronger timeline outlines
for selected spans. These scoped presentation overrides preserve DSH's record
colors and interactions; the original component source and CSS remain intact.

Rebuild the checked-in browser assets:

```sh
npm --prefix viewer/vendor/dsh-turn-navigator ci --ignore-scripts
npm --prefix viewer/vendor/dsh-turn-navigator run build
```
