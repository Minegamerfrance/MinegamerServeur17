# FIFA 20 server 1.8.25

- Corrects season pass pack preview `halId` to the existing native gold pack artwork identifier 4, instead of the internal reward pack ID 1010 which produces a dark generic fallback.
- Uses existing client artwork (`icon_pack_4.dds` / generic gold pack). No new images or client modifications.
- Actual reward remains pack 1010, Two Rare Gold Players, with the same quantity and untradeable status. Coin previews, Tolisso 85, objectives, XP and claims are unchanged.
- No Frosty, launcher or FIFA 17 changes.

Validated on temporary databases: all seasonal pack previews use artwork ID 4 while rewards retain pack ID 1010 and their quantities; pass claims and actual pack delivery, Tolisso preview, objectives, exclusive rewards and Squad Battles regression tests pass. Client screenshots confirm 1.8.24 Objectives and Tolisso rendering; corrected pack artwork still requires an in-game check after restart.
