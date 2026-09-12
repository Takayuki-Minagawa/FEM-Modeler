"""Independent numerical checks of generated packages, after solver-tests/run.py."""
import json
import math
import os
from pathlib import Path

import pytest

OUTPUT = Path(os.environ.get("FEM_SOLVER_FIXTURES", str(Path(__file__).parent / "artifacts")))
REFERENCES = json.loads((Path(__file__).parent / "references.json").read_text())
CASES = [f"{domain}_{variant}" for domain in ("frame", "truss", "solid", "thermal", "fluid") for variant in ("SI", "mm", "benchmark")]
CASES += [f"{domain}_{variant}_mpi2" for domain in ("solid", "thermal") for variant in ("SI", "mm", "benchmark")]
METRICS = {}


def read(case, name="result_manifest.json"):
    return json.loads((OUTPUT / case / name).read_text())


def field(package, name):
    return next(item for item in package["fields"] if item["name"] == name)


def close(name, actual, expected, rel=1e-8, absolute=1e-10):
    METRICS[name] = {"actual": actual, "reference": expected, "absolute_tolerance": absolute, "relative_tolerance": rel}
    assert math.isclose(actual, expected, rel_tol=rel, abs_tol=absolute), (name, actual, expected)


def test_all_solver_processes_exit_successfully():
    report = json.loads((OUTPUT / "execution-report.json").read_text())
    assert {entry["case"] for entry in report} == set(CASES)
    assert all(entry["return_code"] == 0 for entry in report)


@pytest.mark.parametrize("case", CASES)
def test_package_provenance_and_measured_conservation(case):
    manifest = read(case)
    exported = read(case, "export_manifest.json")
    package = read(case, "result_package.json")
    for key in ("project_id", "analysis_case_id", "export_target", "input_fingerprint", "comparison_fingerprint", "run_id", "model_revision"):
        assert manifest[key] == exported[key] == package["manifest"][key]
    mesh = package["mesh"]
    assert mesh["source"]["input_fingerprint"] == manifest["input_fingerprint"]
    node_ids = {node["id"] for node in mesh["nodes"]}
    assert len(node_ids) == len(mesh["nodes"])
    assert all(set(element["node_ids"]) <= node_ids for element in mesh["elements"])
    for result_field in package["fields"]:
        assert len(result_field["values"]) == len(result_field["entity_ids"])
        assert all(math.isfinite(value) for value in result_field["values"])
    if case.startswith(("frame", "truss")):
        assert manifest["analysis_return_code"] == 0
        for index, (applied, reaction) in enumerate(zip(manifest["applied_force_N"], manifest["reaction_force_N"])):
            close(f"{case}.force_balance_{index}_N", applied + reaction, 0, absolute=manifest["balance_tolerance_N"])
        for index, (applied, reaction) in enumerate(zip(manifest["applied_moment_Nm"], manifest["reaction_moment_Nm"])):
            close(f"{case}.moment_balance_{index}_Nm", applied + reaction, 0, absolute=manifest["moment_balance_tolerance_Nm"])
    if case.startswith(("thermal", "solid")):
        assert manifest["converged_reason"] > 0
        assert all(count > 0 for count in manifest["physical_tag_counts"].values())
    if case.startswith("thermal"):
        close(f"{case}.heat_balance_W", sum(manifest["heat_boundary_outward_W"]), manifest["heat_source_W"], absolute=manifest["heat_balance_tolerance_W"])
    if case.startswith("fluid"):
        assert "Mesh OK." in (OUTPUT / case / "checkMesh.log").read_text()
        nodes = [node["position"] for node in mesh["nodes"]]
        area = (max(row[0] for row in nodes) - min(row[0] for row in nodes)) * (max(row[1] for row in nodes) - min(row[1] for row in nodes))
        expected_h = math.sqrt(area / len(mesh["elements"]))
        close(f"{case}.representative_mesh_size_m", manifest["representative_mesh_size"], expected_h)
        assert mesh["representative_size"] == manifest["representative_mesh_size"]
        close(f"{case}.mass_balance_kg_s", sum(manifest["mass_boundary_outward_kg_s"]), 0, absolute=manifest["mass_balance_tolerance_kg_s"])
        last = manifest["residual_history"][-1]["values"]
        for name, tolerance in manifest["residual_tolerances"].items():
            assert math.isfinite(last[name]) and last[name] <= tolerance
        METRICS[f"{case}.final_residuals"] = last


@pytest.mark.parametrize("domain", ["frame", "truss"])
def test_opensees_analytic_axial_frame_and_virtual_work_truss(domain):
    package = read(domain + "_benchmark", "result_package.json")
    displacement = field(package, "uy_m")
    values = dict(zip(displacement["entity_ids"], displacement["values"]))
    max_y = max(node["position"][1] for node in package["mesh"]["nodes"])
    reference = REFERENCES[domain]
    for node in package["mesh"]["nodes"]:
        if node["position"][1] == max_y:
            close(f"{domain}.top_node_{node['id']}_uy_m", values[node["id"]], reference["reference"], reference["relative_tolerance"], reference["absolute_tolerance"])


@pytest.mark.parametrize("domain", ["solid", "thermal"])
def test_dolfinx_analytic_fields(domain):
    package = read(domain + "_benchmark", "result_package.json")
    result_field = field(package, "temperature" if domain == "thermal" else "uy_m")
    values = dict(zip(result_field["entity_ids"], result_field["values"]))
    errors = []
    for node in package["mesh"]["nodes"]:
        x, y, _ = node["position"]
        expected = 300 + 20 * (x + 0.5) - 5 * (x + 0.5)**2 if domain == "thermal" else -1e6 / 200e9 * (y + 0.5)
        errors.append(abs(values[node["id"]] - expected))
    close(f"{domain}.analytic_field_max_error", max(errors), 0, absolute=REFERENCES[domain]["absolute_tolerance"])
    if domain == "thermal":
        close("thermal.total_generation_W", read("thermal_benchmark")["heat_source_W"], 4.0)


def test_developed_poiseuille_profile_and_pressure_gradient():
    package = read("fluid_benchmark", "result_package.json")
    nodes = {node["id"]: node["position"] for node in package["mesh"]["nodes"]}
    speed = dict(zip(field(package, "velocity_magnitude")["entity_ids"], field(package, "velocity_magnitude")["values"]))
    pressure = dict(zip(field(package, "pressure")["entity_ids"], field(package, "pressure")["values"]))
    errors, expected_values, samples = [], [], []
    for element in package["mesh"]["elements"]:
        xyz = [sum(nodes[node_id][axis] for node_id in element["node_ids"]) / 8 for axis in range(3)]
        x, y, _ = xyz
        if abs(x) < 1:
            expected = 6 * 0.001 * (y + 0.5) * (0.5 - y)
            errors.append((speed[element["id"]] - expected)**2)
            expected_values.append(expected**2)
        if abs(y) < 0.03 and abs(x) < 1:
            samples.append((x, pressure[element["id"]]))
    relative_error = math.sqrt(sum(errors) / sum(expected_values))
    close("fluid.profile_relative_L2_error", relative_error, 0, absolute=REFERENCES["fluid"]["relative_tolerance"])
    xmean = sum(x for x, _ in samples) / len(samples)
    pmean = sum(p for _, p in samples) / len(samples)
    slope = sum((x - xmean) * (p - pmean) for x, p in samples) / sum((x - xmean)**2 for x, _ in samples)
    close("fluid.pressure_gradient_Pa_per_m", slope, -12 * 998.2 * 0.01 * 0.001, rel=REFERENCES["fluid"]["relative_tolerance"])


@pytest.mark.parametrize("domain", ["frame", "truss", "solid", "thermal", "fluid"])
def test_si_mm_display_invariance(domain):
    left = read(domain + "_SI", "result_package.json")
    right = read(domain + "_mm", "result_package.json")
    assert left["manifest"]["input_fingerprint"] == right["manifest"]["input_fingerprint"]
    for one, two in zip(left["fields"], right["fields"]):
        assert one["name"] == two["name"]
        close(f"{domain}.SI_mm.{one['name']}.minimum", min(one["values"]), min(two["values"]), rel=1e-9, absolute=1e-10)
        close(f"{domain}.SI_mm.{one['name']}.maximum", max(one["values"]), max(two["values"]), rel=1e-9, absolute=1e-10)


@pytest.mark.parametrize("case", [f"{domain}_{variant}" for domain in ("solid", "thermal") for variant in ("SI", "mm", "benchmark")])
def test_mpi_one_two_process_aggregate_invariance(case):
    one, two = read(case), read(case + "_mpi2")
    for key in ("solution_min", "solution_max"):
        close(f"{case}.MPI.{key}", one[key], two[key], rel=1e-7, absolute=1e-9)
    assert one["physical_tag_counts"] == two["physical_tag_counts"]
    if case.startswith("thermal"):
        for index, (first, second) in enumerate(zip(one["heat_boundary_outward_W"], two["heat_boundary_outward_W"])):
            close(f"{case}.MPI.heat_flux_{index}_W", first, second, rel=1e-7, absolute=1e-9)


def teardown_module():
    OUTPUT.mkdir(exist_ok=True, parents=True)
    (OUTPUT / "verification-report.json").write_text(json.dumps({"metrics": METRICS, "references": REFERENCES}, indent=2, allow_nan=False))
