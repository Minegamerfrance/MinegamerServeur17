# FIFA 20 server 1.8.30

- Handles the exact native live messaging endpoint observed in the client logs: /ut/ut/game/fifa20/livemessage/template?screen=futlivemsggen4&pagesize=5.
- Previously only the shorter /template alias was handled; the actual client request fell back to an empty response and skipped the announcements.
- Both routes now supply the same OTW 1 and TOTW 1 message template.
- Keeps the confirmed intro-seen persistence from 1.8.29 unchanged.
- Tests cover the actual native request path and the existing alias. In-game poster rendering still requires confirmation.
