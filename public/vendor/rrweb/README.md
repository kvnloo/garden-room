# rrweb 2.1.7 (MIT)

Locally vendored from the official npm `rrweb@2.1.7` tarball. No CDN is contacted.

- `umd/rrweb.min.js` → `rrweb.min.js` (recorder + Replayer)
- `dist/style.min.css` → `style.min.css`
- `LICENSE`: upstream MIT license, https://github.com/rrweb-io/rrweb/blob/main/LICENSE
- Source/docs: https://github.com/rrweb-io/rrweb
- npm tarball SHA-1 reported by npm pack: `4f864f277e4b8545ef72a5dc61929f17d2fb5571`

SHA-256 of vendored files:

```
e49e62397b603438476e0d6b5ca3b6e6d4f23a80594e596aff29ac04fa3e1b1c  LICENSE
2007712c70cd4a098e079dd71fdfacf4bbe6e9f4b401fa321df1ffb53b075834  rrweb.min.js
334d222824ebab92111f7db3231829847443a86ae26326cf4f68d5c5fdee40f9  style.min.css
```

Update deliberately by packing a pinned npm version, extracting those files, preserving the
upstream license, updating this manifest, and running the replay/storage/phone verification in
`docs/REPLAY.md`. Do not enable WebGL draw-command recording without a fresh phone overhead test.
