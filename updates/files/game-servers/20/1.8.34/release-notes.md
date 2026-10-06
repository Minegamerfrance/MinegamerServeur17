# FIFA 20 server 1.8.34

- Fixes the native FUTLOAD converter selection introduced in 1.8.33. Keeps the Aruba HTTP provider but selects LiveMessageConverter (1), which allocates the complete 0xa0-byte MessageInfo and fills its image area map.
- The 20:08:33 client minidump shows LiveScreenViewModel::OnContentReceived copying that map from an incompatible 0x58-byte ContentInfo produced by converter 0, causing an access violation before image downloads.
- Preserves OTW1/TOTW1 posters, native loading routes, disabled modal notifications, intro flags, rewards and Squad Battles. No Frosty, game binary changes or artificial loading delay.
- Server regression tests verify converter 1 and asset delivery. Restart the server and game; actual in-game rendering and crash-free entry still require verification.
