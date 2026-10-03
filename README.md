# Nutrition Coach

A personal, closed-loop nutrition app: phase engine (Cut → Lean Bulk → Final Cut), weekly calorie reviews,
a fixed diet solved to exact macros, USDA micronutrients, logging, grocery list, and a streak/XP layer.

- **Local-first:** everything is saved in this device's IndexedDB first, so it works offline.
- **Synced:** when signed in, records are copied to a private Supabase table (`nutrition_records`)
  protected by row-level security. Newest change wins; deletes travel too.
- **Backups:** the cloud button (top right) → Download / Copy / Restore backup.

## Setup (once)
1. Supabase → SQL Editor → run `supabase-setup.sql`.
2. GitHub → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

## Updating
Bump `VERSION` in `sw.js` whenever files change, so installed copies pick up the new version.

Tests: `npm test`.
