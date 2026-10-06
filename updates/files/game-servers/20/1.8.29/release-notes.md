# FIFA 20 server 1.8.29

- Persists native userHubData instead of returning fixed flags after every login.
- Includes userHubClientData in userMassInfo so the onboarding video is skipped only after its native watched flag has been saved.
- Preserves the intro-seen flag when later hub flag updates arrive, without suppressing the first viewing for a new account.
- Supplies liveMessagesAvailable in the initial userMassInfo hub block, before the live messaging screen checks availability.
- Retains both OTW 1 and TOTW 1 posters from 1.8.28. No balances, rewards or pack availability changes.
- Server tests cover first viewing, repeat entry, flag persistence, invalid updates, bootstrap messaging and season-pass regressions. Client display requires an in-game check.
