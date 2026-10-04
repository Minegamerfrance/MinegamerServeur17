# FIFA 20 server 1.8.18

- Adds Alphonso Davies 86 Player Moments (50566044), with his exact FIFA 20 attributes and dynamic portrait.
- Adds Corentin Tolisso 85 Storyline / Season Reward (50551331), with his exact attributes and dynamic portrait. Season progression is not implemented by this update.
- Both are untradeable reward-only cards: excluded from packs and CPU market pools; listing these resources is rejected. Discard value is zero.
- Davies has a non-repeatable two-squad SBC: 84 rating and one TOTW in each squad; 80 chemistry and one Bundesliga player in the first, 75 chemistry in the second.
- Finishing both squads grants Davies to unassigned items. Persistent reward markers prevent duplicate grants and recover an interrupted delivery on server startup.
- Portraits use the native 180x180 DXT5 DDS header and size. Existing reward items retain their inventory state while their card metadata is refreshed.
- The local club grant is a separate backed-up operation; no personal inventory or saved database is included in this public package.

Validated on a temporary database: card stats, DDS decoding and HTTP responses, one-time grants, listing rejection, pack exclusions, SBC validation, full submission flow, repeat submission and existing James/Icon/TOTW/OTW regressions. In-game rendering remains to be checked after restart.
