# Local browser regression tests

```bash
npx playwright install chromium
npm run build
npx playwright test
```

Set `PLAYWRIGHT_BROWSERS_PATH` during both installation and execution if browsers should use a custom cache directory. No GitHub Actions run is needed. Playwright starts a production Vite preview on port 4178 at the same `/FEM-Modeler/` base path as Pages, then shuts it down. Test files use `.e2e.ts` so Vitest does not collect them.

Coverage follows the model-generation scope:

- Six geometry templates without loads, supports, analysis cases, or solver assumptions; modeling-only navigation also after opening an older analysis project.
- Dimension and placement edits, pattern copies, topology changes, named-group rules, reviewed material assignment, cross-section assignment, and Undo/Redo.
- Model consistency checks without requiring materials or analysis setup; JSON/Bundle handoff and reload retaining model composition.
- STEP/IGES import, exact source retention, CAD handoff, malformed-file recovery, and two placed native bodies exported together as STEP and reimported.
- Recovery preservation after more than six seconds and a language change, project/version switching, failed-save protection, modal focus, two-tab conflicts, offline reload/restore, and large STL worker import.
- Keyboard editing and save/reload at 600, 1024, 1280, and 1440 pixels.

Each test gets a fresh browser context. Tests operate through public controls and inspect downloaded files. Traces and failure screenshots are retained on failure; CAD and responsive scenarios also save screenshots. Analysis execution, result imports, and solver packages belong to a separate application and are not product workflows tested here.
