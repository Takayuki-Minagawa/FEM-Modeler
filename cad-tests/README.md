# Native CAD exchange verification

This local suite uses **Python 3.12.12, uv, and cadquery-ocp 7.9.3.1.1**. Python dependencies and native wheel hashes are locked in `uv.lock`. It runs independently of the application's JavaScript packages and WebAssembly build. OCP and OpenCascade.js share the OCCT kernel family, so this verifies the independent binding/build and analytic geometry rather than claiming kernel diversity.

```bash
uv sync --locked --project cad-tests
uv run --locked --project cad-tests pytest cad-tests/test_fixtures.py -q
```

The checked-in fixtures in `tests/fixtures/cad` are original procedural geometry. No proprietary CAD data is included. To regenerate them using the independent native writer:

```bash
uv run --locked --project cad-tests python cad-tests/generate_fixtures.py
```

The generator immediately reads every valid file back and checks exact B-rep quantities against analytic formulas. Header timestamps and author metadata are stable. The JSON reference includes file hashes, formulas/shape descriptions, native readback metrics, unit declarations and tolerances. The 21 tests cover:

| Shape | Units | Exchange files |
| --- | --- | --- |
| Cylinder, radius 10 mm and height 30 mm, axis +Z | mm, m, inch | STEP and IGES B-rep |
| 40 × 30 × 12 mm box with radius 5 mm through-hole | mm, m | STEP and IGES B-rep |
| Two solids: translated box and cylinder with local Y rotation of 90 degrees then translation | mm, m | STEP and IGES B-rep |
| Same holed box as seven trimmed surfaces | mm | Conventional IGES surface representation |
| Invalid/truncated input | n/a | STEP and IGES |

Native geometry coordinates use millimeters internally. Reader results are explicitly normalized to SI: `bbox_m` is `[xmin,ymin,zmin,xmax,ymax,zmax]`, volume is in m³, surface area is in m², and center of mass is in m. Bounding boxes and physical properties use underlying curves/surfaces rather than triangles. Surface area and volume use adaptive Gauss integration with relative target `1e-10`; fixed-order integration can be inaccurate for rational NURBS. Planarity is evaluated geometrically, so converting a planar cap to NURBS does not make it count as a curved surface. The suite checks B-rep validity and solid counts, and does not silently sew or heal surface-only files into solids. The IGES surface fixture therefore has no volume or solid center of mass.

## Checking application exports

For files exported from an imported fixture, compare against that fixture's analytic reference, regardless of the output format or declared length unit:

```bash
uv run --locked --project cad-tests python cad-tests/verify_exports.py \
  /tmp/roundtrip.step /tmp/roundtrip.iges \
  --reference holed_box_mm.step --report /tmp/cad-export-report.json
```

For native application primitives or transformed geometry, supply independently calculated SI expectations in a JSON file. Relative file paths resolve against the expectations file's directory:

```json
{
  "cases": [
    {"file": "roundtrip.step", "reference": "cylinder_mm.step"},
    {
      "file": "native_box.iges",
      "expected": {
        "solid_count": 1,
        "bbox_m": [0, 0, 0, 0.01, 0.02, 0.03],
        "volume_m3": 0.000006,
        "surface_area_m2": 0.0022,
        "center_of_mass_m": [0.005, 0.01, 0.015]
      }
    }
  ]
}
```

```bash
uv run --locked --project cad-tests python cad-tests/verify_exports.py \
  --expectations /tmp/expectations.json --report /tmp/cad-export-report.json
```

The verifier returns nonzero for parse/transfer failures, invalid B-reps, missing solids, incorrect placement, or incorrect shape quantities. A bare file argument without expectations only measures geometry and reports `measured_only`; it does not claim agreement with an intended shape. Tolerances are relative `1e-6`, absolute length `1e-8 m`, and absolute area/volume `1e-12` in SI.

No GitHub Actions are invoked by these commands. This suite verifies CAD exchange; it does not generate FEM boundary conditions or claim solver readiness.

## Full application export validation

The real WASM tests can retain 54 exports: 15 input fixtures × 2 formats, 9 native shapes × 2 formats, and 3 cylinder transformations × 2 formats. `application_expectations.py` independently calculates native shape quantities and explicit frame/truss member endpoints from the generator/viewer specification; it does not import the CAD exporter. Transform expectations cover translation, 90-degree Y rotation, nonuniform scale and mirror. The elliptic cylinder area uses independent numerical integration of the analytic ellipse perimeter.

```bash
CAD_EXPORT_ARTIFACTS=/tmp/fem-cad-js-exports npx vitest run tests/cad/kernel.test.ts
uv run --locked --project cad-tests python cad-tests/application_expectations.py \
  --directory /tmp/fem-cad-js-exports --output /tmp/cad-expectations.json
uv run --locked --project cad-tests python cad-tests/verify_exports.py \
  --expectations /tmp/cad-expectations.json --report /tmp/cad-readback.json
uv run --locked --project cad-tests python cad-tests/write_report.py \
  --input /tmp/cad-readback.json
```

For additional browser artifacts, copy the E2E downloads to a stable directory as `browser-cylinder-roundtrip.step` and `browser-cylinder-roundtrip.iges`, then add `--browser-directory /tmp/fem-cad-browser-exports` to `application_expectations.py`. These browser tests use the inch cylinder fixture. The release report at `docs/cad-validation.json` is written only when every requested output has passed an explicit reference comparison.

Independent readback found an OCCT exchange defect in the conventional IGES surface fixture: a left-handed nested placement was lost during STEP writing, moving the hole's curved surface from `z=[0,12] mm` to `z=[-12,0] mm` despite valid topology and unchanged area. Baking nested placements into geometry before writing fixes the exchange. The full readback check retains this case as a regression.

OCP's official package provides the pinned native binding: [cadquery-ocp 7.9.3.1.1 on PyPI](https://pypi.org/project/cadquery-ocp/7.9.3.1.1/). Writer behavior follows the OCCT exchange APIs: [IGESControl_Writer reference](https://dev.opencascade.org/doc/refman/html/_i_g_e_s_control___writer_8hxx.html) and [STEPControl_Controller unit definitions](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/DataExchange/TKDESTEP/STEPControl/STEPControl_Controller.cxx).
