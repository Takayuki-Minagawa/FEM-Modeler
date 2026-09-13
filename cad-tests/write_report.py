"""Record only successfully compared native readbacks as a release validation artifact."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/"docs/cad-validation.json")
    args = parser.parse_args()
    source = json.loads(args.input.read_text())
    if not source["cases"] or any(case["status"] != "passed" for case in source["cases"]):
        raise SystemExit("Refusing a release validation record containing failures or measurement-only cases")
    cases = []
    for case in source["cases"]:
        measured = {key: value for key, value in case["measured"].items() if key != "segments_m"}
        expected = {key: value for key, value in case["expected"].items() if key != "segments_m"}
        cases.append({"file": Path(case["file"]).name, "sha256": case["sha256"], "status": case["status"], "measured": measured, "expected": expected, "explicit_member_endpoints_compared": "segments_m" in case["expected"]})
    report = {"validated_at_utc": datetime.now(timezone.utc).isoformat(), "validator": source["validator"], "ocp_version": source["ocp_version"], "python_version": source["python_version"], "case_count": len(cases), "checks": ["native STEP/IGES parser and transfer", "BRepCheck validity", "SI bbox/volume/surface area/center of mass", "solid count and curved surface preservation", "frame/truss explicit member endpoints and total length", "mm/m/inch source units", "translation/rotation/nonuniform scaling/mirror"], "references": ["tests/fixtures/cad/references.json", "cad-tests/application_expectations.py"], "reproduction": "cad-tests/README.md", "limits": ["OCP and OpenCascade.js use separate bindings/builds but share the OCCT kernel family.", "Surface-only IGES is checked as surfaces; no implicit sewing or solid volume is asserted.", "Validation covers these geometric fixtures and transforms, not arbitrary CAD or downstream FEM readiness."], "cases": cases}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False)+"\n")
    print(f"Recorded {len(cases)} successful native CAD readbacks: {args.output}")


if __name__ == "__main__":
    main()
