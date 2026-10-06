# FIFA 20 server 1.8.31

- Supplies the exact native featured-opponent expiry field, endTimeStamp, for TOTW 1 in Squad Battles.
- The FIFA 20 featured stats parser reads endTimeStamp rather than endTime or nextFeatureSquadTimeStamp. Its opponent tile requires this timestamp to be positive and the squad ID to be nonnegative.
- Reports pointsWon as -1 before the first completed TOTW match, preserving the native unplayed state instead of showing zero points as a completed challenge.
- Keeps TOTW 1 players, normal opponents, match settlement, seasonal rewards and entry announcements unchanged.
- Squad Battles, season pass and live messaging regression tests pass. In-game selection and match launch require player confirmation after restarting the server and FIFA 20.
