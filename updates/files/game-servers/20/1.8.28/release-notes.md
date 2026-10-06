# FIFA 20 server 1.8.28

- Adds the supplied OTW 1 and TOTW 1 posters to native FUT entry live messaging.
- Enables live messaging in FIFA 20 settings and supplies the native message template, image renders and acknowledgement route.
- Serves both posters locally as PNG files, preserving their original dimensions and decoded pixels. The supplied files were actually WebP and JPEG despite their .png names.
- Keeps existing pack availability, player rewards, season progress and Squad Battles unchanged.
- Server-side tests cover both images, native message fields, acknowledgements, identity and balance isolation. Actual client rendering still requires an in-game check after restarting.
