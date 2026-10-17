# Validation

## Phase 1

Commands run from this repository:

```sh
npm run build
TZ=Europe/Berlin npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
# With the build complete and no existing dev server on port 5173:
PLAYWRIGHT_USE_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Validated on 2026-10-17 with Node 24.19.0 and Chromium 154: production build passed;
20 unit/component tests passed; all 4 browser tests passed against both the Vite
development server and production preview. `npm audit --omit=dev` reported zero
known production dependency vulnerabilities. The reusable cloud setup script was
also executed successfully with a frozen `npm ci` installation.

The build type-checks TypeScript and creates a Vite production bundle. Vitest uses
fake-indexeddb for actual Dexie transactions, not mocked repository methods.
Component tests use React Testing Library. Playwright uses real Chromium and a
fresh browser context per test; it starts and stops its own Vite server.

Coverage includes:

- Exactly three cards and one image/Blob from three masks.
- Idempotent reviews, immutable event replay, equal-time event ordering, all FSRS
  fields and Dates surviving persistence, independent card scheduling.
- Atomic rollback of partially attempted creation.
- Mask edit/add/remove retaining unrelated IDs/history; undo before save.
- Descendant queries, cycle prevention, movement, cascade deletion and safe Blob GC.
- Daily new limits across decks and local calendar review boundaries including DST.
- Native Chromium clipboard paste, real mouse drawing, file upload/validation,
  mobile navigation/theme persistence, review/reveal/rating and page reload.
- Continuing reviews after network disconnection with the app already loaded.
- Normalized target alignment after resizing to mobile, zoom, and pan.

Playwright screenshots and failure traces are local ignored outputs in
`test-results/`. No test result from a different run counts as current evidence.

## Acceptance status

| Scenario | Status in Phase 1 |
| --- | --- |
| A: screenshot creates 3 independent cards / 1 image | Automated in real Chromium |
| B: multi-device sync | Unimplemented; requires Phase 2 and Supabase |
| C: restart offline, review 20, synchronize once | Unimplemented; requires Phase 3; loaded-app offline review tested separately |
| D: concurrent offline reviews converge | Canonical replay unit-tested only; cloud integration unrun |
| E: nested decks | Local transactional and browser tests |
| F: mobile image geometry | Resize/zoom/pan browser test; physical iOS/pinch testing outstanding |
| G: tenant and private-image isolation | Unimplemented; Phase 2 security tests required |
| H: full export/import | Unimplemented; Phase 4 |
| I: interrupted cloud operations | Unimplemented; Phase 2 |

Production hosting, Supabase, browser installation, service-worker caching, Safari,
and physical-device performance have not been validated in Phase 1.
