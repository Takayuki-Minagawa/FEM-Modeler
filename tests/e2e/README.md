# Local browser regression tests

```bash
npx playwright install chromium
npm run build
npx playwright test
```

Set `PLAYWRIGHT_BROWSERS_PATH` during both installation and execution if browsers should use a custom cache directory. No GitHub Actions run is needed. Playwright starts a production Vite preview on port 4178 at the same `/FEM-Modeler/` base path as Pages, then shuts it down. Test files use `.e2e.ts` so Vitest does not collect them.

Coverage includes recovery preservation after more than six seconds and a language change, project/version switching, dimension regeneration, single and batch delete/Undo, JSON and OpenSeesPy ZIP downloads, modal focus, two-tab conflict protection, offline reload/restore, large STL/CSV worker import, and actual thermal-result contour/legend display. Each test gets a fresh browser context. Traces and failure screenshots are retained on failure; the thermal test also records a contour screenshot for visual inspection.
