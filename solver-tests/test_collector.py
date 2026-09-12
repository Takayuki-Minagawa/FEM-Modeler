"""Regression checks for parsing measured OpenFOAM output without native execution."""
import importlib.util
import json
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[1] / "src/export/openfoam/runtime/collect_results.py"
spec = importlib.util.spec_from_file_location("openfoam_collector", path)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def test_patch_sampling_cannot_mix_future_output_from_a_previous_run(tmp_path):
    directory = tmp_path / "0"
    directory.mkdir()
    (directory / "surfaceFieldValue.dat").write_text("# Time sum(phi)\n10 -0.001\n20 -0.002\n1000 -999\n")
    assert collector.read_table(tmp_path, 20) == [20, -0.002]
    with pytest.raises(ValueError, match="iteration 30"):
        collector.read_table(tmp_path, 30)


def test_patch_measurement_is_required(tmp_path):
    with pytest.raises(ValueError, match="No measured patch values"):
        collector.read_table(tmp_path, 1)


def test_ascii_vector_internal_field_preserves_cell_order(tmp_path):
    path = tmp_path / "U"
    path.write_text("internalField nonuniform List<vector> 2 ((1 2 3) (-1 0 0));")
    assert collector.internal_field(path, 2, vector=True) == [[1, 2, 3], [-1, 0, 0]]
    with pytest.raises(ValueError, match="Invalid internal field"):
        collector.internal_field(path, 3, vector=True)


def test_conflicting_restart_samples_cannot_select_an_old_run(tmp_path):
    for folder, value in (("0", -0.002), ("10", -0.004)):
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "surfaceFieldValue.dat").write_text(f"20 {value}\n")
    with pytest.raises(ValueError, match="Conflicting patch samples"):
        collector.read_table(tmp_path, 20)


def exported_manifest():
    return {**dict.fromkeys(("project_id", "analysis_case_id", "export_target", "input_fingerprint", "comparison_fingerprint", "run_id", "model_revision"), "fixture"),
            "dimensionality": "2D", "patches": {"inlet": "inlet", "outlet": "outlet", "wallTop": "top", "wallBottom": "bottom", "frontAndBack": "frontAndBack", "frontAndBackType": "empty"}, "material": {"density": 1000}}


@pytest.mark.parametrize("solver_status", [0, 7])
def test_failed_collection_invalidates_previous_success(tmp_path, monkeypatch, solver_status):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "export_manifest.json").write_text(json.dumps(exported_manifest()))
    (tmp_path / "result_package.json").write_text('{"manifest":{"execution_return_code":0}}')
    (tmp_path / "solver.log").write_text("Time = 1\nSolving for Ux, Initial residual = 1, Final residual = 0.01\n")
    with pytest.raises(ValueError):
        collector.collect(solver_status)
    assert not (tmp_path / "result_package.json").exists()
    failure = json.loads((tmp_path / "result_manifest.json").read_text())
    assert failure["execution_return_code"] == (solver_status or 1)
    assert failure["collection_errors"]


def write_box_mesh(folder, depth):
    mesh = folder / "constant/polyMesh"
    mesh.mkdir(parents=True)
    points = [(0, 0, 0), (2, 0, 0), (2, 1, 0), (0, 1, 0), (0, 0, depth), (2, 0, depth), (2, 1, depth), (0, 1, depth)]
    (mesh / "points").write_text("\n8\n(\n" + "\n".join("(" + " ".join(map(str, row)) + ")" for row in points) + "\n)\n")
    (mesh / "faces").write_text("\n6\n(\n4(0 4 7 3)\n4(1 2 6 5)\n4(0 1 5 4)\n4(3 7 6 2)\n4(0 3 2 1)\n4(4 5 6 7)\n)\n")
    (mesh / "owner").write_text("\n6\n(0 0 0 0 0 0)\n")
    (mesh / "neighbour").write_text("\n0\n()\n")
    (mesh / "boundary").write_text("walls { nFaces 4; startFace 0; }\nfrontAndBack { nFaces 2; startFace 4; }")
    latest = folder / "20"
    latest.mkdir()
    (latest / "p").write_text("internalField uniform 3;")
    (latest / "U").write_text("internalField uniform (1 0 0);")
    return latest


@pytest.mark.parametrize("depth", [0.1, 0.01])
@pytest.mark.parametrize("dimension", ["2D", "3D"])
def test_actual_mesh_representative_size_uses_physical_dimension(tmp_path, monkeypatch, depth, dimension):
    monkeypatch.chdir(tmp_path)
    latest = write_box_mesh(tmp_path, depth)
    exported = exported_manifest()
    exported["dimensionality"] = dimension
    manifest = {"density_kg_m3": 1000, "input_fingerprint": "fixture"}
    package = collector.mesh_package(manifest, latest, exported)
    expected = 2 ** 0.5 if dimension == "2D" else (2 * depth) ** (1/3)
    assert package["mesh"]["representative_size"] == pytest.approx(expected)
    assert manifest["representative_mesh_size"] == pytest.approx(expected)
    assert manifest["mesh_volume_m3"] == pytest.approx(2 * depth)


def test_missing_final_fields_records_failure_after_measured_flux(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    exported = exported_manifest()
    (tmp_path / "export_manifest.json").write_text(json.dumps(exported))
    (tmp_path / "result_package.json").write_text("old success")
    (tmp_path / "solver.log").write_text("Time = 20\nSolving for Ux, Initial residual = 1e-5, Final residual = 1e-7\n")
    for name in ("flux_inlet", "flux_outlet", "flux_top", "flux_bottom", "pressure_inlet", "pressure_outlet"):
        directory = tmp_path / "postProcessing" / name / "0"
        directory.mkdir(parents=True)
        (directory / "surfaceFieldValue.dat").write_text("20 0\n")
    with pytest.raises(ValueError, match="No field output"):
        collector.collect()
    assert not (tmp_path / "result_package.json").exists()
    assert json.loads((tmp_path / "result_manifest.json").read_text())["execution_return_code"] == 1
