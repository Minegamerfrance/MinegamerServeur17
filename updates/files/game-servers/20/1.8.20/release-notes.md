# FIFA 20 server 1.8.20

- Introduces a custom MNG Season 1 pass: 30 levels, four daily objectives and four persistent seasonal objectives. This is not a recreation of the original EA season.
- Progress is based on completed FUT matches (100 XP), wins, opened packs, completed SBCs and daily login. Objectives award XP when claimed; total XP is capped at 30,000.
- Daily objectives reset at midnight UTC. Season progress and claimed rewards survive restarts; this initial custom season has no automatic reset.
- Level rewards include coins, untradeable two-rare-gold-player packs and untradeable Storyline Tolisso 85 at level 30. Rewards are claimed transactionally and cannot be duplicated by repeat or concurrent claims.
- Untradeable pass rewards cannot be listed; quick selling them grants zero coins, including in mixed batches. Previously completed SBC replies cannot crash progression tracking.
- Replaces the empty active seasonal campaign response and logs seasonal requests for further in-game compatibility diagnostics. The native campaign schema is inferred from the extracted FIFA 20 UI and existing server response; actual in-game rendering and redemption still require a client test.
- No Frosty, launch configuration, FIFA 17, artwork or existing club reward changes. No database reset or automatic retroactive XP grants.

Validated on temporary database copies: campaign routes, objective eligibility, daily reset, persistence, XP caps, native match start/end and replay protection, concurrent reward claims, rollback on failed reward delivery, pack delivery and tradeability, and Tolisso delivery. Player picks, exclusive SBC rewards, Boateng, launch promotions and custom icons regression tests pass.
