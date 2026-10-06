# FIFA 20 server 1.8.32

- Removes the incorrect OTW/TOTW Live Messaging notification flow, including repeated empty popups.
- Preserves the confirmed intro-seen flags, Squad Battles and seasonal rewards.
- Includes frosty-fut-loading import files for the actual native FUTLOAD screen: livescreencfg.xml and two existing FUT texture replacements, with originals for restoration.
- The XML uses the FUT-specific fallback loading layout and shows both supplied team posters side by side without a modal notification. Career and Volta layouts remain unchanged.
- Frosty import, mod export and launch through Frosty are required. Updating the server alone cannot install client-side UI resources. No game binaries or Frosty projects were modified automatically.
- Local checks cover XML structure, DDS format and dimensions, aspect ratios, preserved unrelated layouts, disabled notifications and intro flag persistence. In-game rendering is not yet confirmed.
