"""Replay exported run.sh files locally; never dispatch GitHub Actions."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def run(command, **kwargs):
    return subprocess.run(command, check=True, cwd=ROOT, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "solver-tests" / "artifacts")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--only", nargs="*", help="Optional case names, e.g. solid_SI thermal_benchmark")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if not args.skip_build:
        for solver, tag in (("dolfinx", "fem-modeler-dolfinx:0.10.0-amd64"), ("openfoam", "fem-modeler-openfoam:10")):
            run(["docker", "build", "--platform", "linux/amd64", "-f", f"solver-tests/Dockerfile.{solver}", "-t", tag, "solver-tests"])
    if not args.only:
        run(["npx", "vitest", "run", "--config", "solver-tests/vitest.config.ts"], env={**os.environ, "FEM_SOLVER_FIXTURES": str(output)})
    cases = [f"{domain}_{variant}" for domain in ("frame", "truss", "solid", "thermal", "fluid") for variant in ("SI", "mm", "benchmark")]
    report = json.loads((output / "execution-report.json").read_text()) if args.only and (output / "execution-report.json").exists() else []
    for case in cases:
        if args.only and case not in args.only:
            continue
        is_dolfinx = case.startswith(("solid_", "thermal_"))
        for processes in ((1, 2) if is_dolfinx else (1,)):
            name = case if processes == 1 else case + "_mpi2"
            folder = output / name
            if processes == 2:
                folder.mkdir(exist_ok=True)
                for path in (output / case).iterdir():
                    if path.is_file() and path.suffix in (".py", ".geo", ".toml", ".lock", ".sh") or path.name in (".python-version", "export_manifest.json", "input_project.json"):
                        shutil.copy2(path, folder / path.name)
            image = "fem-modeler-openfoam:10" if case.startswith("fluid_") else "fem-modeler-dolfinx:0.10.0-amd64"
            script = "bash run.sh" if is_dolfinx or not case.startswith("fluid_") else "source /opt/openfoam10/etc/bashrc; bash run.sh"
            command = ["docker", "run", "--rm", "--platform", "linux/amd64", "--entrypoint", "bash", "-e", f"NPROC={processes}", "-e", "UV_LINK_MODE=copy", "-e", "UV_CACHE_DIR=/solver-uv-cache", "-v", "fem-modeler-solver-uv-cache:/solver-uv-cache", "-v", f"{output}:/cases", "-w", f"/cases/{name}", image, "-lc", script]
            started = time.monotonic()
            print(f"Running {name}", flush=True)
            with (folder / "runtime.log").open("w") as log:
                completed = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=900)
            report = [row for row in report if row["case"] != name]
            report.append({"case": name, "return_code": completed.returncode, "elapsed_seconds": round(time.monotonic() - started, 3), "image": image, "mpi_processes": processes})
            (output / "execution-report.json").write_text(json.dumps(report, indent=2))
            if completed.returncode:
                print((folder / "runtime.log").read_text()[-5000:], flush=True)
    if any(row["return_code"] for row in report):
        raise SystemExit("One or more solver runs failed; inspect execution-report.json and runtime.log")
    print(f"Completed {len(report)} real solver runs: {output / 'execution-report.json'}", flush=True)


if __name__ == "__main__":
    main()
