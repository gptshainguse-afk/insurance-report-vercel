#!/usr/bin/env python3
"""Compile editable template JSON files into the browser registry."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
ORDER = ("unified", "life", "property")

def build():
    templates = {}
    for template_id in ORDER:
        value = json.loads((ROOT / "templates" / f"{template_id}.json").read_text(encoding="utf-8"))
        if value.get("id") != template_id or not value.get("version"):
            raise ValueError(f"Missing template identity or version: {template_id}")
        fields = value["fields"]
        if len({field["id"] for field in fields}) != len(fields):
            raise ValueError(f"Duplicate field ID: {template_id}")
        for field in fields:
            if not (0 <= field["x"] < value["width"] and 0 <= field["y"] < value["height"]):
                raise ValueError(f"Field is outside the page: {template_id}/{field['id']}")
            if field["w"] <= 0 or field["h"] <= 0 or field["x"] + field["w"] > value["width"] or field["y"] + field["h"] > value["height"]:
                raise ValueError(f"Invalid field bounds: {template_id}/{field['id']}")
        templates[template_id] = value
    output = ROOT / "public" / "templates.js"
    output.write_text("window.TEMPLATES = " + json.dumps(templates, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"file": str(output), "templates": {key: len(value["fields"]) for key, value in templates.items()}}, ensure_ascii=False))

if __name__ == "__main__":
    build()
