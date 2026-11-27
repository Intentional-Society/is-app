"""Harvest scrub for #618. Run from the repo root.

  python scripts/skill-evals/fixtures/harvest-2026-09-27/scrub.py --from-source   # re-copy from the workspaces, then scrub
  python scripts/skill-evals/fixtures/harvest-2026-09-27/scrub.py --check         # verify only; writes nothing; exit 1 on any leak

No identity is stored in this folder. The user name comes from the machine running the scrub
(--user, default: the home folder's name); everything else is a generic pattern. Path shapes are
kept so #619's tool-call producer can be tested against the sample.
"""
import argparse, json, pathlib, re, shutil, sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
SOURCES = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))
UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
BS = chr(92)
SEP = "[" + BS + BS + "/]+"


def rules(user):
    u = re.escape(user)
    return [
        ("[A-Za-z]:" + SEP + "Users" + SEP + u, "<home>"),
        ("/[a-z]/Users/" + u, "<home>"),
        ("--Users-" + u + "-", "--Users-<user>-"),
        (UUID, "<uuid>"),
        ("cc-msg-[0-9a-fA-F]+", "cc-msg-<id>"),
        ("agent-[0-9a-f]{15,}", "agent-<id>"),
        ('"signature"' + BS + "s*:" + BS + 's*"[^"]*"', '"signature":"<redacted>"'),
        (BS + "b" + u + BS + "b", "<user>"),
    ]


ENV_LISTS = ("mcp_servers", "plugins", "skills", "slash_commands", "agents", "tools", "commands")
USAGE_KEYS = ("usage", "modelUsage", "rate_limit_info", "total_cost_usd", "cost_usd")


def _strip(ev):
    if isinstance(ev, dict):
        for key in ENV_LISTS:
            if isinstance(ev.get(key), list):
                ev[key] = []
        for key in USAGE_KEYS:
            if key in ev:
                ev[key] = None
        for v in ev.values():
            _strip(v)
    elif isinstance(ev, list):
        for v in ev:
            _strip(v)
    return ev


def strip_environment(text):
    """Empty the personal environment lists and usage figures, at any depth; keep every key.
    Stream-json (.jsonl) is handled line by line; a .json file is handled as one document and
    re-emitted only if something changed, so untouched files keep their original bytes."""
    lines = text.split("\n")
    if len(lines) > 1 and all(l.strip().startswith("{") or not l.strip() for l in lines):
        out = []
        for line in lines:
            try:
                ev = json.loads(line)
            except ValueError:
                out.append(line)
                continue
            before = json.dumps(ev, ensure_ascii=False)
            after = json.dumps(_strip(ev), ensure_ascii=False)
            out.append(after if after != before else line)
        return "\n".join(out)
    try:
        doc = json.loads(text)
    except ValueError:
        return text
    before = json.dumps(doc, ensure_ascii=False, sort_keys=True)
    _strip(doc)
    if json.dumps(doc, ensure_ascii=False, sort_keys=True) == before:
        return text
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def env_residue(path):
    """Non-empty environment lists or usage values left in a JSON or JSONL file."""
    found = []
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return found
    docs = []
    if path.suffix == ".jsonl":
        for line in text.split("\n"):
            try:
                docs.append(json.loads(line))
            except ValueError:
                pass
    elif path.suffix == ".json":
        try:
            docs.append(json.loads(text))
        except ValueError:
            pass

    def walk(ev):
        if isinstance(ev, dict):
            for k, v in ev.items():
                if (k in ENV_LISTS and isinstance(v, list) and v) or (k in USAGE_KEYS and v not in (None, [], {})):
                    found.append(k)
                walk(v)
        elif isinstance(ev, list):
            for v in ev:
                walk(v)

    for d in docs:
        walk(d)
    return found


def scrub_text(text, user, name):
    if name.endswith(".jsonl") or name.endswith(".json"):
        text = strip_environment(text)
    for pat, rep in rules(user):
        text = re.sub(pat, rep, text)
    return text


def data_files():
    return [HERE / e["dest"] for e in SOURCES["files"]]


def leaks(user):
    found = []
    for p in sorted(HERE.rglob("*")):
        if not p.is_file():
            continue
        s = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(s.split("\n"), 1):
            if re.search(BS + "b" + re.escape(user) + BS + "b", line) or re.search(UUID, line) or re.search('"signature"' + BS + 's*:' + BS + 's*"(?!<redacted>)[^"]+"', line):
                found.append(f"{p.relative_to(HERE)}:{i}")
        if p.name not in ("sources.json",):
            for key in env_residue(p):
                found.append(f"{p.relative_to(HERE)}: environment key '{key}' not empty")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default=pathlib.Path.home().name)
    ap.add_argument("--from-source", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.from_source:
        for e in SOURCES["files"]:
            src, dst = REPO / e["source"], HERE / e["dest"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        changed = 0
        for p in data_files():
            s = p.read_text(encoding="utf-8")
            t = scrub_text(s, a.user, p.name)
            if t != s:
                changed += 1
                p.write_bytes(t.replace("\r\n", "\n").encode("utf-8"))
        print(f"copied {len(SOURCES['files'])} files from source; scrubbed {changed}")
    found = leaks(a.user)
    print(f"leaks: {len(found)}" + ("" if not found else " -> " + ", ".join(found[:20])))
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
