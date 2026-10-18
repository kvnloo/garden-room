Route modules: each `routes/<name>.py` defines `handle(h, method, path) -> bool`.
`h` is the request handler: `h.body()` (JSON dict), `h.send_json(code, obj)`, `h.headers`, `h.rfile`, `h.path`.
Auth is checked before modules run. Return True only for paths you own (prefix `/api/<name>/`).
Import server helpers lazily: `import server` is NOT available; pass what you need via constants in your module.
Restart: `systemctl --user restart garden-room`.
