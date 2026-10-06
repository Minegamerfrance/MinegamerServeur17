# FIFA 20 server 1.8.26

- Adds native `awardedPrizes` to season level claim responses, including `awardType`, `awardValue` and quantity. The client milestone claim parser reads this field instead of the legacy `awards` alias. Repeat claims return no prizes and never grant another reward.
- Connects the TOTW viewer to the existing 23 TOTW 1 promotional players. The featured squad history now returns the native integer list `[1]` for `sqbttotw`, instead of an empty squad object that the client cannot parse as history.
- Provides the TOTW 1 featured squad with existing native squad structure, a 3-4-3 formation, all 23 promotional resource IDs, ratings and existing portraits. Preview items are not added to the user's inventory.
- Preserves Squad Battles, market/pack eligibility, objective progress, claimed rewards and currency balances. No Frosty, launcher or FIFA 17 modifications.

Validated against the FIFA 20 native response parsers and extracted TOTW navigation, plus temporary-database pass, exclusive reward and Squad Battles tests. Immediate currency refresh and the TOTW screen still require an in-game check after restarting the server.
