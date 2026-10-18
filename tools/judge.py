#!/usr/bin/env python3
"""Vision judge for plant-model builders whose own model cannot see images.

  python3 tools/judge.py <reference.png> <render1.png> [render2.png ...] [--brief "what to check"]

Sends the reference cutout and renders to ChatGPT (subscription route, same OAuth as the Codex CLI)
and prints a JSON verdict: {"score":0-10,"matches":[...],"fixes":[...ordered, concrete...]}.
"""
import base64, io, json, sys, time, urllib.request
from pathlib import Path
from PIL import Image

URL = "https://chatgpt.com/backend-api/codex/responses"


def creds():
    auth = json.loads((Path.home() / ".codex/auth.json").read_text())
    tok = auth["tokens"]["access_token"]
    claims = json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + "=="))
    acct = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id") or auth["tokens"].get("account_id")
    return tok, acct


def b64(p, side=768):
    im = Image.open(p).convert("RGBA")
    bg = Image.new("RGBA", im.size, (200, 200, 200, 255)); bg.alpha_composite(im)
    im = bg.convert("RGB"); im.thumbnail((side, side))
    buf = io.BytesIO(); im.save(buf, "PNG"); return base64.b64encode(buf.getvalue()).decode()


def main():
    args = sys.argv[1:]; brief = ""
    if "--brief" in args:
        i = args.index("--brief"); brief = args[i + 1]; args = args[:i] + args[i + 2:]
    ref, renders = args[0], args[1:]
    text = ("Image 1 is a REFERENCE photo cutout of a real potted plant. The other images are renders of a procedural "
            "Three.js model meant to look like that plant (different viewpoints). Judge how well the model matches the "
            "reference: leaf shape/size/count/arrangement, stem structure, overall silhouette and proportions, colours, pot. "
            "Be strict and concrete. Reply ONLY with JSON: {\"score\": <0-10>, \"matches\": [short strings], "
            "\"fixes\": [ordered list of the most impactful concrete geometry/material changes, max 6]}. " + brief)
    content = [{"type": "input_text", "text": text}] + [{"type": "input_image", "image_url": "data:image/png;base64," + b64(p)} for p in [ref, *renders]]
    body = {"model": "gpt-6-astra", "instructions": "You are a strict 3D art reviewer. Output JSON only.",
            "input": [{"type": "message", "role": "user", "content": content}], "stream": True, "store": False}
    tok, acct = creds()
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "Accept": "text/event-stream",
         "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.153.4 (garden-room-judge)"}
    if acct: h["ChatGPT-Account-ID"] = acct
    out = ""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(URL, json.dumps(body).encode(), h, method="POST"), timeout=180) as r:
                for raw in r:
                    line = raw.decode("utf-8", "replace").strip()
                    if line.startswith("data:"):
                        try: ev = json.loads(line[5:])
                        except ValueError: continue
                        if ev.get("type") == "response.output_text.delta": out += ev.get("delta", "")
            break
        except OSError:
            if attempt == 2: raise
            time.sleep(3)
    s = out[out.find("{"): out.rfind("}") + 1]
    try: print(json.dumps(json.loads(s), indent=1))
    except ValueError: print(out)


if __name__ == "__main__":
    main()
