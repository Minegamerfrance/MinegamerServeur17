# FIFA 20 server 1.8.35

- Replaces FUTLOAD DDS poster URLs with PNG URLs, serving the existing decoded RGB PNG assets. Keeps native converter 1 and the same aspect-preserving layout.
- The 20:17 logs confirm successful native content and otw1.dds downloads. The new minidump reports D3D12 CreateCommittedResource returning E_INVALIDARG (0x80070057), not the MessageInfo memory corruption fixed in 1.8.34.
- New PNG URLs avoid reusing the previously downloaded DDS cache keys; no user cache or game files are deleted. Old loading DDS routes are rejected and their files are excluded from the package.
- No driver or DirectX settings changes, Frosty requirements, modal notifications or balance changes.
- Local tests verify PNG signatures, RGB decoding, dimensions, converter selection and related server regressions. Restart the server and game; crash-free image rendering still needs an in-game test.
