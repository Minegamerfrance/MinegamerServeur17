# FIFA 20 server 1.8.22

- Removes the release-tuning guard that incorrectly classified offline Squad Battles as an unavailable online mode and returned HTTP 409 for `/sqbt/user/hub`.
- Delegates Squad Battles and featured squad requests to the existing native runtime implementation instead of replacing its responses. Division Rivals and FUT Champions remain blocked as before.
- Includes the 1.8.21 Objectives feature flag, category detail and native reward route fixes. The local installation had reverted to 1.8.20 during testing; this package explicitly retains those fixes.
- No database reset, new rewards, image edits, Frosty changes, game launching changes or FIFA 17 modifications.

Validated on temporary database copies: active Squad Battles hub, opponent list and each opponent's player squad, featured squad stats, preserved Rivals/Champions guards. Season pass, player picks, exclusive SBC rewards, Boateng, launch promotions and custom icons regression tests pass.

Full in-game navigation and match completion still require a client test after installing 1.8.22 and restarting the FIFA 20 server and game.
