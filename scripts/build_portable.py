#!/usr/bin/env python3
"""Rebuild public/portable.html from this project's static application.

Uses Python's standard library only. Run after updating the application,
template registry and PDF/PNG assets. The output contains the original PDFs,
preview images, fonts, CSS and JavaScript, with no network dependencies.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
ASSET_EXTENSIONS = {".pdf", ".png", ".ttf", ".otf", ".woff", ".woff2"}
SCRIPT_TAG = re.compile(r"<script\b(?P<attrs>[^>]*)>\s*</script\s*>", re.IGNORECASE)
SRC_ATTRIBUTE = re.compile(r"\bsrc\s*=\s*(['\"])(.*?)\1", re.IGNORECASE)
LINK_TAG = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
ATTRIBUTE = re.compile(r"([\w-]+)\s*=\s*(['\"])(.*?)\2", re.IGNORECASE)


def local_file(public: Path, reference: str) -> Path:
    """Accept only local references contained by the public directory."""
    if re.match(r"(?:[a-z][a-z0-9+.-]*:|//)", reference, re.IGNORECASE):
        raise ValueError(f"Cannot inline an external resource: {reference}")
    if "?" in reference or "#" in reference:
        raise ValueError(f"Resource references must be plain local paths: {reference}")
    file = (public / reference.lstrip("/")).resolve()
    if not file.is_relative_to(public) or not file.is_file():
        raise ValueError(f"Missing or invalid local resource: {reference}")
    return file


def script_element(source: str, attributes: str = "") -> str:
    # HTML parsing ends a script at </script even within a JavaScript string.
    safe = re.sub(r"</script", r"<\\/script", source, flags=re.IGNORECASE)
    return "<script" + attributes + ">\n" + safe + "\n</script>"


def build(public: Path, output: Path | None = None) -> Path:
    public = public.resolve()
    output = output.resolve() if output else public / "portable.html"
    html = (public / "index.html").read_text(encoding="utf-8")
    assets_directory = public / "assets"
    font = assets_directory / "CJK-Fallback.ttf"
    if not font.is_file():
        raise ValueError("The bundled assets/CJK-Fallback.ttf font is missing.")
    asset_files = sorted(file for file in assets_directory.rglob("*")
                         if file.is_file() and file.suffix.lower() in ASSET_EXTENSIONS)
    if not any(file.suffix.lower() == ".pdf" for file in asset_files):
        raise ValueError("No template PDFs were found in public/assets.")
    assets = {
        file.relative_to(public).as_posix(): base64.b64encode(file.read_bytes()).decode("ascii")
        for file in asset_files
    }

    styles_inlined = 0
    scripts_inlined = 0

    def replace_stylesheet(match: re.Match[str]) -> str:
        nonlocal styles_inlined
        tag = match.group(0)
        attrs = {item[0].lower(): item[2] for item in ATTRIBUTE.findall(tag)}
        if "stylesheet" not in attrs.get("rel", "").lower().split():
            return tag
        source = local_file(public, attrs.get("href", "")).read_text(encoding="utf-8")
        styles_inlined += 1
        return "<style>\n" + source + "\n</style>"

    def replace_script(match: re.Match[str]) -> str:
        nonlocal scripts_inlined
        attrs = match.group("attrs")
        src = SRC_ATTRIBUTE.search(attrs)
        if not src:
            return match.group(0)
        source = local_file(public, src.group(2)).read_text(encoding="utf-8")
        source = re.sub(r"(?m)^//# sourceMappingURL=.*$", "", source)
        remaining_attrs = attrs[:src.start()] + attrs[src.end():]
        scripts_inlined += 1
        return script_element(source, remaining_attrs)

    html = LINK_TAG.sub(replace_stylesheet, html)
    html = SCRIPT_TAG.sub(replace_script, html)
    embedded = script_element("window.EMBEDDED_ASSETS = "
                              + json.dumps(assets, separators=(",", ":")) + ";")
    if not re.search(r"</head\s*>", html, re.IGNORECASE):
        raise ValueError("index.html does not contain a closing head tag.")
    html = re.sub(r"</head\s*>", lambda _: embedded + "\n</head>",
                  html, count=1, flags=re.IGNORECASE)

    notices = (assets_directory / "THIRD-PARTY-NOTICES.txt").read_text(encoding="utf-8")
    notice_comment = "<!--\nTHIRD PARTY NOTICES\n" + notices.replace("--", "- -") + "\n-->\n"
    html = re.sub(r"</body\s*>", lambda _: notice_comment + "</body>",
                  html, count=1, flags=re.IGNORECASE)
    if re.search(r"<script\b[^>]*\bsrc\s*=", html, re.IGNORECASE):
        raise ValueError("An external script remains in the offline output.")
    if any("stylesheet" in match.group(0).lower() for match in LINK_TAG.finditer(html)):
        raise ValueError("An external stylesheet remains in the offline output.")
    if not scripts_inlined or not styles_inlined:
        raise ValueError("Expected application scripts and stylesheet were not inlined.")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(html, encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({"file": str(output), "bytes": output.stat().st_size,
                      "embedded_assets": len(assets), "scripts": scripts_inlined,
                      "stylesheets": styles_inlined}, ensure_ascii=False))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    build(args.public_dir, args.output)
