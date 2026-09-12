# Editing and draft-save microbenchmark

Run locally (no GitHub Actions required):

```bash
FEM_PERFORMANCE=1 npx vitest run tests/performance/history-performance.test.ts
```

The opt-in test writes `latest-results.json` with the machine/runtime, 100 scalar-edit p95 timings, history-size proxies, full JSON serialization time, 100 inexpensive size estimates, and initial/warm save timings. Fixtures cover a small project, a synthetic base64 payload representing a 10 MiB STL, and 100,000 scalar result rows.

`legacy-undo-manager.fixture.ts` preserves the pre-refactor clone/diff algorithm solely for reproducible comparison. The baseline's serialized patch bytes and the current implementation's conservative retained-value estimate are different measures, not measured heap allocations. Initial asset/result creation and Immer freezing are excluded from edit timings. Save measurements use Node and fake IndexedDB; browser disk latency, quota and scheduling require separate end-to-end checks.

The last local run used an Apple M4 Max and Node 22.18.0. Current edit p95 stayed below 0.1 ms for all three fixtures, and warm saves were below 10 ms. These are observations, not cross-device performance guarantees. The measured size estimator avoids JSON serialization altogether. Worker migration is therefore unnecessary for this save-scheduling path; STL parsing and CSV import remain separate workloads to profile before moving to a worker.

## Import profiling and worker decision

```bash
FEM_PERFORMANCE=1 npx vitest run tests/performance/import-performance.test.ts
```

`import-results.json` records a separate cold run of the actual parser paths. On the same M4 Max, binary STL parsing, topology checks, hash and base64 encoding took **1,279 ms** for 10 MiB / 209,713 triangles. Parsing a three-component CSV with 100,000 rows took **54 ms**. Input construction is outside those timings. These are single-run observations; lower-powered devices can take longer.

Large STL import must move off the UI thread to avoid more than a second of blocked interaction. Large CSV import also warrants a worker route. Small imports can retain the synchronous implementation as a tested fallback where workers are unavailable. The save-scheduling improvement alone does not solve import responsiveness. Worker transfer/reconstruction overhead needs a browser smoke test after implementation.

The UI now routes STL files of at least 1 MiB through a module worker, transfers the input and geometry buffers, and cancels work when the dialog closes or another file is chosen. Main-thread geometry reconstruction preserves the existing asset format. A Chromium smoke test imports 25,000 triangles (1.25 MB) through the worker and compares every exported asset byte with the original file. The worker uses the application's shared chunks, avoiding the additional 104 kB produced by a separate Three geometry bundle.
