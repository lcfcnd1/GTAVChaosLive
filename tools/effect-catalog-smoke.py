"""Verify that implemented effect IDs stay aligned across the mod and UI layers."""
from pathlib import Path
import json
import re
import sys


ROOT = Path(__file__).resolve().parents[1]


def ids_from(pattern: str, text: str) -> list[str]:
    return re.findall(pattern, text, re.MULTILINE | re.DOTALL)


def main() -> int:
    mod = (ROOT / "mods/gta-chaos-live/ChaosScript.cs").read_text(encoding="utf-8")
    orchestrator = (ROOT / "services/orchestrator/src/index.ts").read_text(encoding="utf-8")
    dashboard = (ROOT / "apps/dashboard/src/main.tsx").read_text(encoding="utf-8")

    mod_ids = ids_from(r'public string Id\s*\{\s*get\s*\{\s*return "([^"]+)"', mod)
    default_block = re.search(r"const defaultEffectConfigs: EffectConfig\[\] = \[(.*?)\n\].map", orchestrator, re.DOTALL)
    effects_block = re.search(r"const effects = \[(.*?)\];", dashboard, re.DOTALL)
    if not default_block or not effects_block:
        raise SystemExit("could not locate effect catalog declarations")
    orchestrator_ids = ids_from(r'\["([^"]+)",\s*"[^"]+",\s*"[^"]+",', default_block.group(1))
    dashboard_ids = ids_from(r'id: "([^"]+)"', effects_block.group(1))

    sets = {"mod": mod_ids, "orchestrator": orchestrator_ids, "dashboard": dashboard_ids}
    duplicates = {name: sorted({item for item in values if values.count(item) > 1}) for name, values in sets.items()}
    expected = set(mod_ids)
    missing = {name: sorted(expected - set(values)) for name, values in sets.items()}
    extra = {name: sorted(set(values) - expected) for name, values in sets.items()}
    passed = len({frozenset(values) for values in sets.values()}) == 1 and not any(duplicates.values())
    result = {
        "passed": passed,
        "counts": {name: len(values) for name, values in sets.items()},
        "missing": missing,
        "extra": extra,
        "duplicates": duplicates,
    }
    print(json.dumps(result, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
