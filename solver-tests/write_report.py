"""Produce the concise checked-in validation record only from successful real runs."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True, help="Directory created by run.py")
    parser.add_argument("--report", type=Path, default=Path(__file__).resolve().parents[1] / "docs/solver-validation.json")
    args = parser.parse_args()
    executions = json.loads((args.output / "execution-report.json").read_text())
    verification = json.loads((args.output / "verification-report.json").read_text())
    status = json.loads((args.output / "test-status.json").read_text())
    if status["exit_code"] or any(run["return_code"] for run in executions):
        raise SystemExit("Refusing to record a successful report for failed validation")
    cases = []
    for execution in executions:
        folder = args.output / execution["case"]
        manifest = json.loads((folder / "result_manifest.json").read_text())
        package = json.loads((folder / "result_package.json").read_text())
        row = {**execution, "input_fingerprint": manifest["input_fingerprint"], "node_count": len(package["mesh"]["nodes"]), "element_count": len(package["mesh"]["elements"])}
        for key in ("solver_version", "python_version", "gmsh_version", "physical_tag_counts", "solution_min", "solution_max", "applied_force_N", "reaction_force_N", "force_imbalance_N", "balance_tolerance_N", "moment_imbalance_Nm", "moment_balance_tolerance_Nm", "heat_boundary_outward_W", "heat_source_W", "heat_balance_tolerance_W", "mass_boundary_outward_kg_s", "mass_balance_tolerance_kg_s", "pressure_drop_Pa"):
            if key in manifest:
                row[key] = manifest[key]
        if manifest.get("residual_history"):
            row["final_residuals"] = manifest["residual_history"][-1]
            row["residual_tolerances"] = manifest["residual_tolerances"]
        cases.append(row)
    metrics = {key: value for key, value in verification["metrics"].items() if any(token in key for token in ("top_node", "analytic_field", "profile_relative", "pressure_gradient", "total_generation"))}
    report = {"validated_at_utc": datetime.now(timezone.utc).isoformat(), "scope": "Five templates, independent analytic references, SI/mm display invariance, DOLFINx MPI 1/2, conservation and measured residuals", "native_platform": "linux/amd64 (Docker Desktop on Apple Silicon)", "uv_version": "0.9.7", "native_images": {"dolfinx_and_opensees": "ghcr.io/fenics/dolfinx/dolfinx@sha256:f7cce2a2271bf838c080751348c471064acb41fef0330e2c08178a688f71890d", "openfoam": "openfoam/openfoam10-paraview510@sha256:d6ff1f9a2e7bc3c9177f373bebbdeb542fd8b49144afc24d5e3a3cd9bfae253d"}, "test_status": status, "solver_run_count": len(executions), "analytic_metrics": metrics, "cases": cases, "references_file": "solver-tests/references.json", "reproduction": "solver-tests/README.md", "limits": ["Validation covers the current strict exporter profiles and these fixtures; it does not validate arbitrary imported CAD or general CFD/VTK/XDMF formats.", "OpenFOAM benchmark checks the developed central channel region. The error tolerance is 3%; template process success is independently checked against measured residuals.", "DOLFINx visualization uses a P1 output mesh while the native XDMF result retains its original order."]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
