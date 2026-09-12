"""Collect OpenFOAM 10 ASCII output; all conservation values retain their signs."""
import json
import math
import platform
from pathlib import Path
import re
import sys


def read_table(directory, expected_iteration=None):
    paths = sorted(Path(directory).glob("*/surfaceFieldValue.dat"), key=lambda p: float(p.parent.name))
    rows = []
    for path in paths:
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                rows.append([float(value) for value in re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?", line)])
    if not rows:
        raise ValueError(f"No measured patch values: {directory}")
    if expected_iteration is not None:
        rows = [row for row in rows if row[0] == expected_iteration]
        if not rows:
            raise ValueError(f"No patch values at solver iteration {expected_iteration}: {directory}")
    latest = max(rows, key=lambda row: row[0])
    if any(row != latest for row in rows if row[0] == latest[0]):
        raise ValueError(f"Conflicting patch samples at iteration {latest[0]}: {directory}")
    return latest


def clean_text(path):
    text = Path(path).read_text()
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def list_body(path):
    text = clean_text(path)
    match = re.search(r"\n\s*(\d+)\s*\(\s*", text)
    if not match:
        raise ValueError(f"Expected ASCII list: {path}")
    return int(match[1]), text[match.end():].rsplit(")", 1)[0]


def internal_field(path, count, vector=False):
    text = clean_text(path)
    scalar = r"([-+\d.eE]+)"
    pattern = r"\(([^)]+)\)" if vector else scalar
    uniform = re.search(r"internalField\s+uniform\s+" + pattern + r"\s*;", text)
    if uniform:
        value = [float(x) for x in uniform[1].split()] if vector else float(uniform[1])
        return [value] * count
    match = re.search(r"internalField\s+nonuniform\s+List<\w+>\s+(\d+)\s*\((.*?)\)\s*;", text, re.S)
    if not match or int(match[1]) != count:
        raise ValueError(f"Invalid internal field: {path}")
    values = [[float(x) for x in item.split()] for item in re.findall(r"\(([^)]+)\)", match[2])] if vector else [float(x) for x in match[2].split()]
    if len(values) != count:
        raise ValueError(f"Wrong field length: {path}")
    return values


def subtract(left, right):
    return [a - b for a, b in zip(left, right)]


def cross(left, right):
    return [left[1]*right[2] - left[2]*right[1], left[2]*right[0] - left[0]*right[2], left[0]*right[1] - left[1]*right[0]]


def face_triangles(face, points):
    return [(points[face[0]], points[face[index]], points[face[index + 1]]) for index in range(1, len(face) - 1)]


def mesh_package(manifest, latest, exported):
    count, body = list_body("constant/polyMesh/points")
    points = [[float(value) for value in row.split()] for row in re.findall(r"\(([^)]+)\)", body)]
    if len(points) != count:
        raise ValueError("Wrong point count")
    _, body = list_body("constant/polyMesh/faces")
    faces = [[int(value) for value in row.split()] for row in re.findall(r"\d+\(([^)]+)\)", body)]
    _, body = list_body("constant/polyMesh/owner")
    owners = [int(value) for value in body.split()]
    _, body = list_body("constant/polyMesh/neighbour")
    neighbors = [int(value) for value in body.split()]
    cell_count = max(owners + neighbors) + 1
    cells = [[] for _ in range(cell_count)]
    for face_index, owner in enumerate(owners):
        cells[owner].append(face_index)
    for face_index, neighbor in enumerate(neighbors):
        cells[neighbor].append(face_index)
    boundary_text = clean_text("constant/polyMesh/boundary")
    tags = {}
    for match in re.finditer(r"(\w+)\s*\{([^{}]+)\}", boundary_text):
        size = re.search(r"nFaces\s+(\d+)", match[2])
        start = re.search(r"startFace\s+(\d+)", match[2])
        if size and start:
            for face_index in range(int(start[1]), int(start[1]) + int(size[1])):
                tags[face_index] = match[1]
    elements = []
    aspect_ratios = []
    total_volume = 0.0
    for cell_index, face_ids in enumerate(cells):
        base = faces[face_ids[0]]
        adjacency = {}
        for face_id in face_ids:
            face = faces[face_id]
            for left, right in zip(face, face[1:] + face[:1]):
                adjacency.setdefault(left, set()).add(right)
                adjacency.setdefault(right, set()).add(left)
        if len(base) != 4 or len(adjacency) != 8:
            raise ValueError("Result package supports only blockMesh hexahedra")
        opposite = []
        for node in base:
            outside = adjacency[node] - set(base)
            if len(outside) != 1:
                raise ValueError("Ambiguous hexahedron connectivity")
            opposite.append(outside.pop())
        edge_lengths = [math.dist(points[left], points[right]) for left, adjacent in adjacency.items() for right in adjacent if left < right]
        aspect_ratios.append(max(edge_lengths) / min(edge_lengths))
        center = [sum(points[node][axis] for node in adjacency) / len(adjacency) for axis in range(3)]
        # Convex blockMesh cells are partitioned into tetrahedra from the cell
        # center and each triangulated face, independent of owner orientation.
        for face_id in face_ids:
            for a, b, c in face_triangles(faces[face_id], points):
                normal = cross(subtract(b, a), subtract(c, a))
                total_volume += abs(sum(x*y for x, y in zip(subtract(a, center), normal))) / 6
        elements.append({"id": str(cell_index), "type": "hexa8", "node_ids": [str(node) for node in base + opposite], "boundary_tags": sorted({tags[face] for face in face_ids if face in tags})})
    if not math.isfinite(total_volume) or total_volume <= 0:
        raise ValueError("Positive finite mesh volume required")
    if exported["dimensionality"] == "2D":
        front_back = exported["patches"]["frontAndBack"]
        area = sum(math.sqrt(sum(x*x for x in cross(subtract(b, a), subtract(c, a)))) / 2
                   for index, tag in tags.items() if tag == front_back
                   for a, b, c in face_triangles(faces[index], points)) / 2
        if not math.isfinite(area) or area <= 0:
            raise ValueError("Positive finite front/back area required for 2D representative size")
        representative_size = math.sqrt(area / cell_count)
        definition = "sqrt(A/Ncells), where A is half the actual frontAndBack patch area in m^2; excludes the artificial 2D extrusion thickness"
        manifest["mesh_planar_area_m2"] = area
    else:
        representative_size = (total_volume / cell_count) ** (1/3)
        definition = "cbrt(V/Ncells), where V is the sum of actual convex polyMesh cell volumes in m^3"
    manifest.update({"representative_mesh_size": representative_size, "representative_mesh_size_definition": definition, "mesh_volume_m3": total_volume})
    pressure = internal_field(latest / "p", cell_count)
    velocity = internal_field(latest / "U", cell_count, vector=True)
    ids = [str(index) for index in range(cell_count)]
    density = manifest["density_kg_m3"]
    fields = [{"name": "pressure", "location": "cell", "unit": "Pa", "entity_ids": ids, "values": [value * density for value in pressure]}, {"name": "velocity_magnitude", "location": "cell", "unit": "m/s", "entity_ids": ids, "values": [math.sqrt(sum(x*x for x in row)) for row in velocity]}]
    mesh = {"length_unit": "m", "nodes": [{"id": str(index), "position": point} for index, point in enumerate(points)], "elements": elements, "source": {"solver": "OpenFOAM", "generator": "OpenFOAM 10 blockMesh ASCII polyMesh", "input_fingerprint": manifest["input_fingerprint"]}, "quality": [{"name": "cell_edge_aspect_ratio", "definition": "Maximum divided by minimum unique edge length in each actual blockMesh hexahedron; 1 for a cube", "unit": "1", "element_ids": ids, "values": aspect_ratios, "bad_above": 10}]}
    mesh["representative_size"] = representative_size
    return {"format": "fem-modeler-result-package-v1", "manifest": manifest, "mesh": mesh, "fields": fields}


def write_json(path, data):
    # Serialization must succeed before replacing an existing artifact.
    content = json.dumps(data, indent=2, allow_nan=False)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content)
    temporary.replace(path)


def collect(execution_return_code=0):
    Path("result_package.json").unlink(missing_ok=True)
    Path("result_manifest.json").unlink(missing_ok=True)
    exported = json.loads(Path("export_manifest.json").read_text())
    provenance_keys = ("project_id", "analysis_case_id", "export_target", "input_fingerprint", "comparison_fingerprint", "run_id", "model_revision")
    manifest = {key: exported[key] for key in provenance_keys}
    manifest.update({"solver": "OpenFOAM 10 simpleFoam", "python_version": platform.python_version(), "execution_return_code": execution_return_code})
    text = Path("solver.log").read_text() if Path("solver.log").exists() else ""
    history = {}
    iteration = 0
    for line in text.splitlines():
        time = re.match(r"Time = (\d+)", line)
        if time:
            iteration = int(time[1])
        residual = re.search(r"Solving for (\w+), Initial residual = ([\d.eE+-]+), Final residual = ([\d.eE+-]+)", line)
        if residual:
            values = history.setdefault(iteration, {})
            values[residual[1]] = max(values.get(residual[1], 0), float(residual[2]))
    manifest["residual_history"] = [{"iteration": iteration, "values": values} for iteration, values in sorted(history.items())]
    manifest["residual_tolerances"] = {field: 1e-4 for field in ("p", "Ux", "Uy") + (("Uz",) if exported["dimensionality"] == "3D" else ())}
    manifest["residual_definition"] = "maximum initial normalized equation residual for each field in each SIMPLE iteration"
    try:
        if execution_return_code != 0:
            raise ValueError(f"Solver failed with return code {execution_return_code}")
        if not history:
            raise ValueError("No measured solver residual history")
        last_iteration = max(history)
        patch_names = [exported["patches"][key] for key in ("inlet", "outlet", "wallTop", "wallBottom")]
        if exported["patches"]["frontAndBackType"] != "empty":
            patch_names.append(exported["patches"]["frontAndBack"])
        flux_rows = [read_table(Path("postProcessing") / f"flux_{name}", last_iteration) for name in patch_names]
        if len({row[0] for row in flux_rows}) != 1:
            raise ValueError("Patch flux samples do not share a time")
        volume_flux = [row[1] for row in flux_rows]
        density = exported["material"]["density"]
        if not isinstance(density, (int, float)) or density <= 0:
            raise ValueError("Positive density required for mass balance")
        mass_flux = [value * density for value in volume_flux]
        manifest.update({"boundary_patch_names": patch_names, "volume_boundary_outward_m3_s": volume_flux, "density_kg_m3": density, "mass_boundary_outward_kg_s": mass_flux, "mass_source_kg_s": 0, "mass_balance_tolerance_kg_s": 1e-6 * max(1e-9, *(abs(value) for value in mass_flux)), "flux_sign_convention": "positive outward", "flux_sample_iteration": flux_rows[0][0]})
        inlet_p = read_table(Path("postProcessing") / "pressure_inlet", last_iteration)[1]
        outlet_p = read_table(Path("postProcessing") / "pressure_outlet", last_iteration)[1]
        manifest["pressure_drop_Pa"] = (inlet_p - outlet_p) * density
        latest = Path(str(last_iteration))
        if not latest.is_dir():
            raise ValueError(f"No field output at final solver iteration {last_iteration}; older checkpoints cannot be mixed with the final manifest")
        package = mesh_package(manifest, latest, exported)
        manifest["collection_errors"] = []
        write_json(Path("result_manifest.json"), manifest)
        write_json(Path("result_package.json"), package)
    except (ValueError, KeyError, IndexError, OSError, ZeroDivisionError) as error:
        Path("result_package.json").unlink(missing_ok=True)
        manifest.update({"collection_errors": [str(error)], "execution_return_code": execution_return_code or 1, "execution_status": "collection_failed"})
        write_json(Path("result_manifest.json"), manifest)
        raise
    return manifest


if __name__ == "__main__":
    collect(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
