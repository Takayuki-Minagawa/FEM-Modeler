# Real solver validation (local, uv)

Python dependencies and interpreter versions are fixed by each project's `pyproject.toml`, `uv.lock` and `.python-version`. Native runtimes use the digest-pinned Dockerfiles. Both Linux images run as **amd64**: Gmsh 4.15.1 and the tested OpenSeesPy native wheel require this platform. Apple Silicon hosts use Docker's amd64 emulation.

| Solver | Verified runtime |
| --- | --- |
| OpenSeesPy | Python 3.12.12, Python wrapper and native `openseespylinux` 3.7.1.2, BLAS/LAPACK from the pinned DOLFINx image |
| DOLFINx | 0.10.0, Python 3.12.3, PETSc/MUMPS/MPI from the pinned image; Gmsh 4.15.1 from uv |
| OpenFOAM | Foundation 10 `simpleFoam`; result collector Python 3.12.12 |
| Environment manager | uv 0.9.7, pinned container image digest |

Prerequisites: Docker Desktop/Engine with Linux amd64 execution, Node/npm dependencies installed, uv 0.9.7.

```bash
uv sync --locked --project solver-tests/openfoam
uv run --locked --project solver-tests/openfoam python solver-tests/run.py --output /private/tmp/fem-solver-validation
FEM_SOLVER_FIXTURES=/private/tmp/fem-solver-validation uv run --locked --project solver-tests/openfoam pytest solver-tests/test_results.py solver-tests/test_collector.py -q
```

Use `/tmp/fem-solver-validation` on Linux, or another absolute writable directory. **The pytest command is a separate, required verification step.** The runner checks process exit codes; pytest checks physical results. The runner builds the images unless `--skip-build` is set, exports exactly the same file maps used by browser ZIP downloads, and executes their `run.sh` files. It does not dispatch GitHub Actions.

The runner executes 21 cases: all five templates in SI/mm display units, five separate analytic benchmarks, and a second MPI process count for all six DOLFINx cases. `references.json` stores equations, quantities, units, references, and tolerances. The fluid benchmark evaluates the developed central region of a uniform-inlet, low-Re channel, accounting for entrance/outlet effects by excluding those regions.

- OpenSees: frame axial response, truss virtual-work displacement, signed force and global-origin moment balance.
- DOLFINx: actual physical tags, compression solution, P2 heat conduction with generation, variational Dirichlet heat reactions, and MPI 1/2 aggregate agreement. Shared Dirichlet degrees of freedom are split equally between the corresponding boundary totals to avoid double counting. Visualization output is interpolated onto a P1 mesh; XDMF retains the original order.
- OpenFOAM: blockMesh/checkMesh, signed `phi` patch integrals, density conversion to mass flow, initial equation-residual histories, developed Poiseuille velocity/pressure-gradient agreement, and explicit hexahedral connectivity. Fields and patch integrals must come from the final measured solver iteration; conflicting duplicate samples are rejected. `checkMesh` must print `Mesh OK.` because failed checks may still return exit code zero. The 2D exporter requires its extrusion parallel to the global Z axis; out-of-plane rotations are rejected.

OpenFOAM representative mesh size is computed from the actual SI polyMesh: `h = sqrt(A/Ncells)` for 2D, where `A` is half the total front/back patch area, or `h = cbrt(V/Ncells)` for 3D, where `V` is the sum of convex cell volumes. The artificial 2D extrusion thickness therefore cannot affect `h`. Both mesh and result manifest record this value; the manifest includes its definition and measured area/volume.

The output directory contains `execution-report.json`, `verification-report.json`, and each case's runtime log, source project, export/result manifests, result package and solver output. Every launcher invalidates old result packages, result CSV/XDMF/HDF5 and success manifests before environment setup. A failing invocation removes partial success output and records its nonzero exit code in a failure manifest; logs remain available. OpenFOAM also starts with fresh `postProcessing` measurements. The collector applies the same protection when invoked directly. Each completed result package carries the export's exact project/case/input fingerprint/run identity. Template executions and analytic benchmark comparisons are separate checks.

To retry existing exported packages without changing their provenance:

```bash
uv run --locked --project solver-tests/openfoam python solver-tests/run.py --output /private/tmp/fem-solver-validation --skip-build --only thermal_SI
```

A retry preserves the other execution records and also reruns the MPI variant for DOLFINx. Rerun the full command after changing exporter code. `--only` reuses already-exported packages; it does not regenerate them.

Lightweight generated-Python syntax checks in `npm test` use the prepared locked environment via `uv run --locked --offline --no-sync`. Run the first `uv sync` command before tests on a fresh checkout. Native solver runs remain an explicit local step to avoid consuming Actions quota.
