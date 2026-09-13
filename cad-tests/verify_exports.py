"""Read application exports through native OCP and compare with independent SI data."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform

from cad_reference import measure_file
from generate_fixtures import OUTPUT, compare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--reference", help="Fixture filename in tests/fixtures/cad/references.json")
    parser.add_argument("--expectations", type=Path, help='JSON {"cases":[{"file":"relative/or/absolute.step","reference":"fixture.step"} or {"file":"...","expected":{SI metrics}}]}')
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    references = {case["file"]: case["expected"] for case in json.loads((OUTPUT / "references.json").read_text())["cases"]}
    if args.reference and args.reference not in references:
        parser.error(f"Unknown reference: {args.reference}")
    requests = [{"file": path.resolve(), "expected": references.get(args.reference)} for path in args.files]
    if args.expectations:
        for case in json.loads(args.expectations.read_text())["cases"]:
            path = Path(case["file"])
            if not path.is_absolute():
                path = args.expectations.resolve().parent / path
            expected = references[case["reference"]] if "reference" in case else case["expected"]
            requests.append({"file": path, "expected": expected})
    if not requests:
        parser.error("Provide CAD files or an expectations manifest")
    rows = []
    for request in requests:
        path = request["file"]
        row = {"file": str(path), "status": "failed"}
        try:
            row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            row["measured"] = measure_file(path)
            if request["expected"] is not None:
                compare(row["measured"], request["expected"])
                row["expected"] = request["expected"]
                row["status"] = "passed"
            else:
                row["status"] = "measured_only"
        except Exception as error:
            row["error"] = f"{type(error).__name__}: {error}"
        rows.append(row)
    report = {"validator": "native OCP (independent application binding/build; shared OCCT family)", "ocp_version": importlib.metadata.version("cadquery-ocp"), "python_version": platform.python_version(), "cases": rows}
    content = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content)
    print(content)
    raise SystemExit(1 if any(row["status"] == "failed" for row in rows) else 0)


if __name__ == "__main__":
    main()
