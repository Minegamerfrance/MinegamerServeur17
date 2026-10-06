# FIFA 20 server 1.8.27

- Enables TOTW 1 as the Squad Battles featured opponent by supplying native featured stats, squad identity, rating, chemistry, formation, expiry and difficulty point previews.
- Routes featured TOTW match requests to all 23 existing TOTW 1 players rather than a regular CPU squad. Uses a separate internal opponent slot 4 while preserving featured week ID 1.
- Tracks TOTW results and rewards through the existing Squad Battles match settlement, with duplicate settlement protection. Keeps the featured opponent out of the four regular opponent slots.
- Retains the native FIFA 20 TOTW tile crest already available in the extracted client assets. No Frosty, client asset, FIFA 17 or launcher changes.

Validated on temporary databases: featured availability and identity, actual match response with 23 TOTW players, results and rewards, repeat settlement protection, regular opponent isolation, season pass regressions. Actual in-game selection and match play remain to be verified after restart.
