# Dev scripts

## `fresh-check.sh` — clear stale caches & re-run typecheck

After applying a TypeScript fix, the editor or `tsc --watch` can keep showing
old errors from cached `.tsbuildinfo` or Vite's dependency cache. Run this to
guarantee a clean slate:

```bash
bash scripts/fresh-check.sh           # clear caches + fresh typecheck
bash scripts/fresh-check.sh --build   # also run vite build
bash scripts/fresh-check.sh --dev     # clear caches then start dev server
```

What it clears:
- `node_modules/.vite`, `node_modules/.cache`, `.vite`
- `dist/`
- All `*.tsbuildinfo` files (forces full TS re-check via `tsc -b --force`)

Use this whenever you see TypeScript errors that reference code you've
already changed — it almost always means a stale cache.

### Optional: alias it

Add to your shell rc:
```bash
alias fc='bash scripts/fresh-check.sh'
alias fcb='bash scripts/fresh-check.sh --build'
alias fcd='bash scripts/fresh-check.sh --dev'
```
