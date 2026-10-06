# FIFA 20 server 1.8.24

- Handles the client's observed `/scmp/learning/category/{id}/details?groupIdList=...` requests, which previously returned 404 and closed the Objectives screen. Adds corresponding learning objective/group reward paths with the same eligibility and replay protections as campaign claims.
- Removes the duplicate `objectiveProgressList` from group definitions: the native parser appended both it and `objectives`, displaying eight objectives instead of four. Retains the single canonical objective list and native progress/description fields.
- Serializes timeline reward awards with the native `awardType`, `awardCount`, `halId`, `untradeable` and `itemData` fields confirmed in CardsDLL's award parser. Coin and pack previews are distinguished; level 30 supplies a non-persisted preview of Storyline Tolisso 85 (resource 50551331, rarity 91), not a pack fallback.
- Does not grant preview items, reset progress, or change reward eligibility. Keeps existing claims, club items, Squad Battles access and all FIFA 17/Frosty/launch configuration unchanged. No new images.

Temporary database tests pass for observed learning detail requests, invalid group rejection, objective redemption and replays, exactly four objectives per group, native coin/pack/player award types, and Tolisso preview metadata. Existing pass transactions, Squad Battles, exclusive SBC rewards, Boateng, promotions and custom icons regressions pass.

The in-game timeline now opens in 1.8.23; this release addresses the actual subsequent detail 404 and native preview serialization. Final objective detail and card rendering still require an in-game check after restart.
