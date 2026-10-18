#!/usr/bin/env python3
"""Publish a privacy-scrubbed snapshot of this repo to a separate public repo.

The private repo keeps its full history. The public repo gets one commit per
publish, built only from committed files at HEAD, with private paths replaced,
private files excluded and image metadata stripped. Any banned pattern left
after scrubbing aborts the publish (fail closed).

usage: tools/publish_public.py [--push] [--out DIR] [--remote URL]
"""
import argparse, os, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "garden_room-public"
REMOTE = "https://github.com/kvnloo/garden-room.git"
IDENT = ["-c", "user.name=kvnloo", "-c", "user.email=7121943+kvnloo@users.noreply.github.com"]

# Files never published: photos of the home, judge transcripts with local paths,
# deployment units and helpers that encode this host's layout.
EXCLUDE = [
    r"^refs/", r"^data/", r"^work/models/.*/ab/", r"^work/models/.*/judge.*\.json$",
    r"^work/models/.*/.*\.(jpe?g|png)$", r"^deploy/", r"^bin/", r"^tools/history_review_decisions\.json$",
    r"^docs/research/img2threejs-demo-inventory\.json$",
]
# Host-specific scrub rules (path rewrites + banned private literals) live in a
# gitignored file so the rules themselves never leak: data/publish/rules.json
# {"subs": [[regex, replacement], ...], "banned": [regex, ...]}
RULES = ROOT / "data" / "publish" / "rules.json"
# Generic secret shapes, always enforced.
BANNED = [
    "\\d{8,10}:AA[A-Za-z0-9_-]{30,}",
    "\\bsk-[A-Za-z0-9_-]{20,}",
    "\\bgh[pousr]_[A-Za-z0-9]{30,}",
    "\\bAKIA[0-9A-Z]{16}\\b",
    "\\bcsk-[A-Za-z0-9]{20,}",
    "\\bgsk_[A-Za-z0-9]{20,}",
    "xox[abp]-[A-Za-z0-9-]{10,}",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "\\beyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\."
]
TEXT_EXT = {".py", ".js", ".mjs", ".json", ".md", ".css", ".html", ".txt", ".sh", ".service", ".yaml", ".yml", ".toml", ""}
IMG_EXT = {".webp", ".jpg", ".jpeg", ".png"}


def run(*a, **k):
    return subprocess.run(a, check=True, text=True, capture_output=True, **k).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--remote", default=REMOTE)
    a = ap.parse_args()
    import json
    if not RULES.exists():
        sys.exit(f"missing private scrub rules {RULES}; refusing to publish")
    rules = json.loads(RULES.read_text())
    subs, banned = rules["subs"], BANNED + rules["banned"]
    if not banned or not subs:
        sys.exit("empty scrub rules; refusing to publish")
    out = Path(a.out)
    head = run("git", "-C", str(ROOT), "rev-parse", "--short", "HEAD").strip()
    files = [f for f in run("git", "-C", str(ROOT), "ls-files").splitlines()
             if not any(re.search(p, f) for p in EXCLUDE)]
    stage = out.with_name(out.name + ".stage")
    shutil.rmtree(stage, ignore_errors=True)
    problems = []
    for f in files:
        blob = subprocess.run(["git", "-C", str(ROOT), "show", f"HEAD:{f}"], check=True, capture_output=True).stdout
        dst = stage / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        ext = Path(f).suffix.lower()
        if ext in IMG_EXT:
            tmp = dst.with_suffix(".orig" + ext); tmp.write_bytes(blob)
            subprocess.run(["vips", "copy", str(tmp), f"{dst}[strip]" if ext != ".jpg" and ext != ".jpeg" else f"{dst}[strip,Q=90]"],
                           check=True, capture_output=True)
            tmp.unlink()
            continue
        if ext in TEXT_EXT or f in ("LICENSE",):
            try:
                s = blob.decode("utf-8")
            except UnicodeDecodeError:
                problems.append(f"{f}: undecodable text"); continue
            for pat, rep in subs:
                s = re.sub(pat, rep, s)
            for pat in banned:
                for m in re.finditer(pat, s):
                    line = s.count("\n", 0, m.start()) + 1
                    problems.append(f"{f}:{line}: banned /{pat}/")
            dst.write_text(s)
        else:
            problems.append(f"{f}: unknown file type, refusing to publish blindly")
    if problems:
        print("PUBLISH BLOCKED:\n  " + "\n  ".join(problems[:80]), file=sys.stderr)
        sys.exit(2)
    # public-only extras
    (stage / ".gitignore").write_text("node_modules/\n.venv/\ndata/\nwork/\n!work/builders/\n!work/models/\nrefs/\n__pycache__/\n")
    # sync stage into the public repo working tree (keep its .git)
    if not (out / ".git").exists():
        out.mkdir(parents=True, exist_ok=True)
        run("git", "init", "-q", "-b", "main", str(out))
    for p in out.iterdir():
        if p.name != ".git":
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    for p in stage.iterdir():
        shutil.move(str(p), out / p.name)
    shutil.rmtree(stage, ignore_errors=True)
    run("git", "-C", str(out), "add", "-A")
    if run("git", "-C", str(out), "status", "--porcelain").strip():
        run("git", "-C", str(out), *IDENT, "commit", "-q", "-m", f"Publish snapshot of private {head}")
    print(f"staged {len(files)} files -> {out} ({run('git', '-C', str(out), 'rev-parse', '--short', 'HEAD').strip()})")
    if a.push:
        remotes = run("git", "-C", str(out), "remote").split()
        if "origin" not in remotes:
            run("git", "-C", str(out), "remote", "add", "origin", a.remote)
        run("git", "-C", str(out), "push", "-q", "-u", "origin", "main")
        print("pushed", a.remote)


if __name__ == "__main__":
    main()
