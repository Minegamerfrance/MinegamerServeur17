# FIFA 20 server 1.8.36

- Responds with one native loading action containing both poster IMAGE areas instead of two independent actions. Uses the known bodyImage/backgroundImage areas and raises the per-message image limit to two.
- Displays both unchanged PNGs side by side with preserved aspect ratios. Removes dependence on advancing to a second loading message before FUT entry completes.
- Allows the unchanged poster assets to be cached for one day instead of sending no-store. Dynamic content responses remain no-store and the intro flags and gameplay state are unchanged.
- User confirmed the OTW PNG can render in 1.8.35 but reports heavy slowdown when reopening UT. Logs show repeated content requests and OTW fetches without any TOTW fetch; no newer minidump was found. These changes simplify that flow but do not establish that the client-side slowdown is resolved.
- Server tests cover a single action, two native image areas, cache headers, converter 1 and gameplay regressions. Restart the server and game and verify repeated UT entry, both images and responsiveness. No artificial wait or Frosty dependency.
