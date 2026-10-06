# FIFA 20 server 1.8.23

- Corrects seasonal campaign serialization beyond the feature flags added in 1.8.21. The native CardsDLL campaign parser reads category `type` and `priority`, group `groupType`, and level `rewardOptionList`/`chosenOption`; earlier responses omitted these fields.
- Daily and persistent seasonal categories now carry types 1 and 4, both explicitly handled by the native campaign parser. Groups include their type, availability timestamps and objective progress list.
- Level reward options use native objects with `optionId`, `hiddenReward` and `awards`. Claim markers are reflected in `chosenOption` without granting rewards again.
- Adds native campaign `title`, `subtitle`, `serverCrtTime` and `hasPreviousCampaign` metadata. Keeps existing XP, claims, club items, Objectives flag and Squad Battles access.
- Does not alter Frosty, game launching, FIFA 17, images or match results. The latest captured Squad Battles result was a QUIT after 40 seconds, not a completed victory; it is not converted into XP or a win.

Read-only inspection evidence: local FIFA 20 CardsDLL campaign parser at RVA 0x2d5690, category parser at 0x2d6860, level parser at 0x2d5f70, and reward option parser at 0x2d5da0. JSON key table confirms the native field names; no client binary is patched.

Validated on temporary database copies: native category types, timestamps, option IDs and claimed option updates; campaign routes, daily reset, persistence, concurrent claims and rollback; Squad Battles hub/opponents/stats; player picks, exclusive rewards, Boateng availability, launch promotions and custom icons.

Actual in-game Objectives navigation and reward rendering still require client verification. The previous HTTP 200 and visible XP widget did not establish full native campaign compatibility.
