# zoning — LOOP c6 (A1: overlay only while a zoning tool is active)

Nothing here is required. The zoning change works without it. These are follow-ups for the orchestrator and other owners.

1. **ARCHITECTURE.md, views paragraph (§ "Data views").** Change "`views` hides `zoning`'s plates while active" to say that zoning
   draws its plates only while `zone:r|c|i` or `zone:none` (Dezone) is the selected tool (owner ruling: zone tools only, not bulldoze), or always under `?zones=always` and in
   `?showcase=zoning`. `zoning.api.setOverlayVisible(false)` is now a veto layered on top of that rule.
   `setOverlayVisible(true)` lifts the veto but does not force the plates on.
   Also document the new `zoning.api.getOverlayState()` → `{ shown, viewHidden, toolShows, always }`. Tooling can read it.
2. **ARCHITECTURE §7 perf note.** The plates are the only transmissive surfaces in the city. While they are hidden, three skips its
   transmission pre-pass, so the default game is about 190–205 draws and roughly 3.5 ms gpuMs cheaper (game-batch maxima: 1023 → 818 draws,
   10.94 → 7.25 ms). Selecting a zone tool brings that cost back.
3. **tools showcase (`src/tools/showcase.js`, owner: tools).** It commits a real `zone:r` paint near (-67,75), but it sets its tool
   through `internal.setTool` and never emits `tool:selected`. Under the new rule those committed plates are therefore hidden in
   `?showcase=tools`. The `zoning.api.showPreview` ghost still shows. If the showcase is meant to show committed plates, it could emit
   `tool:selected { tool: 'zone:r' }` while staging. Other module showcases that load zoning (buildings, ui, ...) also no longer show plates.
4. **ARCHITECTURE events table.** `tool:selected` lists `tools` as the emitter, but `ui` (`selectTool`) emits it. tools and zoning consume it.
