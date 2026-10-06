# FIFA 20 server 1.8.21

- Enables the native `enableObjectives` settings flag alongside the existing `enableSeasonalCampaigns` flag. Version 1.8.20 populated the XP widget but omitted this separate Objectives feature flag.
- Adds the native category details route `/campaign/active/category/{id}/details?groupIdList=...`, objective redemption `/campaign/group/{id}/objective/{id}/rewards`, and level reward selection `/campaign/level/{id}/reward/0`.
- These setting and route names are confirmed in the local FIFA 20 CardsDLL strings. Category/group membership and reward option validation preserve the existing reward eligibility and replay protections.
- Retains XP, claimed rewards and club items. No Frosty, game launch, FIFA 17 or image changes.

Validated on temporary databases: settings flag, category detail requests and invalid groups, native objective claim and level replay, persistent pass progression and transactional rewards. Existing player picks, exclusive SBC rewards, Boateng, launch promotions and custom icons tests pass.

The client has displayed the 1.8.20 XP widget but rejected Objectives navigation without making a new seasonal request. This release addresses the missing native flag and known route gaps; full in-game category rendering and redemption remain to be confirmed after restarting the server and game.
