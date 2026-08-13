# Rename: EchoBrief → Puffin

A plan, not a script. The name appears in **199 files**, but almost all of those are
display text that a find-and-replace handles safely. The risk is concentrated in about a
dozen identifiers that are load-bearing — change one carelessly and you orphan a user's
audio, break their session, or ship an app the store treats as a different product.

Do the survey first, then the safe bulk, then the dangerous few, deliberately.

---

## The rule that decides everything

**A name is display text or it is an identifier. Never both.**

- **Display text** — "EchoBrief" in a heading, an email, a settings footnote. Change
  freely. Worst case is a typo.
- **Identifier** — bundle id, URL scheme, R2 bucket, package name, Railway service, OAuth
  redirect. These are *referenced by systems outside this repo* — the App Store, Google's
  OAuth console, objects already sitting in a bucket, tokens already on users' phones.
  Changing one is a migration, not a rename.

Everything below is sorted by that distinction.

---

## 1. Safe bulk — display text

**~180 of the 199 files.** Mechanical, reviewable in one diff.

| Area | Files | Notes |
|---|---|---|
| `apps/mobile/app`, `apps/mobile/src` | 39 | UI strings, copy, comments |
| `src/routes`, `src/components` | 29 | web app, landing page, share page |
| `src/server` | 14 | email templates, prompts, log prefixes |
| `docs/`, `*.md` | 29 | including `PRICING.md`, `PRD.md`, `README.md` |
| `migrations` | 21 | **comments only** — see §2 for why they stay |

```bash
# Preview first. Never pipe straight into a write.
grep -rl "EchoBrief" --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=ios --exclude-dir=build . | wc -l

# Then, per area, so the diff stays reviewable:
grep -rl "EchoBrief" apps/mobile/src | xargs sed -i '' 's/EchoBrief/Puffin/g'
```

Two things to watch:

- **Case variants.** `EchoBrief`, `echobrief`, `echo-brief`, `ECHOBRIEF` all exist. Do
  them as separate passes and read each diff — `echobrief` lowercase is often part of an
  identifier and must NOT be swept.
- **The email templates** in `src/server/services/resend.ts` carry the name in subject
  lines that users have already received. Not a technical problem, worth a glance.

---

## 2. Do NOT change

| Thing | Why |
|---|---|
| **Migration files** (21) | They are an applied, immutable history. The name appears only in comments. Editing a migration that has already run against production is how you desync `_migrations`. Leave every one. |
| **`bun.lock`** | Regenerated, not edited. It updates itself when §3 lands. |
| **Existing R2 object keys** | Keys are `{userId}/{meetingId}/…` — they never contained the product name. Only the *bucket* does. See §4. |

---

## 3. Package names — safe, but do them together

`@echobrief/shared` and `@echobrief/mobile` are internal workspace names. Renaming to
`@puffin/*` is safe because nothing outside the repo resolves them, but every import
moves at once:

1. `packages/shared/package.json` → `"name": "@puffin/shared"`
2. `apps/mobile/package.json` → `"name": "@puffin/mobile"`, and its dependency entry
3. Root `package.json` workspaces — no change (glob-based)
4. `apps/mobile/tsconfig.json` path aliases
5. Every `from "@echobrief/shared"` import
6. `Dockerfile` and `Dockerfile.web` — both reference `@echobrief/shared` **in comments
   explaining the COPY layout**; the `COPY packages/` lines are path-based and unaffected
7. `bun install` to regenerate the lockfile

Verify with `npx tsc -p tsconfig.api.json --noEmit` and the mobile `tsc` before moving on.

---

## 4. The dangerous few

Each of these is a decision, not an edit.

### 4a. Bundle identifier — `com.suhaasnv.echobrief`

**The single highest-stakes item.**

If the app is **not yet on the App Store**: change it freely. Update
`apps/mobile/app.json` (`ios.bundleIdentifier`), the Live Activity target's bundle id
(it must remain a child of the app's, e.g. `com.suhaasnv.puffin.liveactivity`), and the
App Store Connect record.

If the app **is** on the store: **do not change it.** A new bundle id is a *new app* —
new listing, no reviews, no ratings, no upgrade path, and existing users keep the old
one forever. The display name can change freely; the bundle id is the identity. Apps
rename constantly without touching it.

Also affected: the Xcode project, entitlements, the App Group if one exists, and the
`expo-web-browser` / Google redirect configuration.

### 4b. URL scheme — `echobrief://`

Used by Google SSO: `NATIVE_RETURN_URIS` in `src/server/api/routes/auth-google.ts` is an
**exact-string allowlist** — deliberately exact, because a prefix check is an open
redirect and this URL carries a session JWT.

Change requires **three things in the same deploy**:
1. `apps/mobile/app.json` → `"scheme": "puffin"`
2. `NATIVE_RETURN_URIS` → `["puffin://auth/callback"]`
3. Ship the mobile build **before or with** the server change

**Order matters.** If the server changes first, every already-installed app sends
`echobrief://` and gets silently rejected back to the web fallback — sign-in appears to
hang. Safest: allowlist **both** schemes for one release, then drop the old one.

Google Cloud console needs no change — Google still redirects to the API's own https
callback.

### 4c. R2 bucket — `echo-brief`

**Do not rename.** Every existing `meetings.audio_key` and `meeting_segments.audio_key`
points into this bucket, and the key format never contained the product name. Renaming
means copying every object and rewriting every row for zero user-visible benefit. A
bucket name is infrastructure; nobody sees it.

If it must change: new bucket → copy all objects → dual-read window → cut over → verify
the reconciliation sweep (`cleanupOldAudioFiles`) points at the new one → delete the old.
Not worth it for a rename.

### 4d. Railway services and `APP_URL`

Services are named `api`, `worker`, `Postgres`, `Redis`, `echobrief` (web). Renaming the
web service changes its generated domain, which is currently
`https://echobrief-production.up.railway.app` — and that is `APP_URL`, which is where the
**web Google SSO callback lands** and where **share links point**.

Consequence: **every share link already sent to someone else breaks.** Share tokens are
128-bit and stored, so the *token* survives — the *host* does not.

Recommendation: buy the real domain first (`getpuffin.com` or similar — `puffin.com` and
`puffin.app` are both taken), point it at the service, and set `APP_URL` to that. Then
the Railway subdomain stops mattering and you never do this again.

### 4e. Database name

`echobrief` locally, Railway-managed in production. **No reason to touch it.** It appears
in `DATABASE_URL` and nowhere a user can see.

---

## 5. Assets and brand

- App icon and splash — `docs/brand/`, `apps/mobile/assets/`. The current mark is an echo
  wave. The puffin mark now exists:

  | File | Use |
  |---|---|
  | `puffin-mascot.png` | The full illustration. Landing page, App Store screenshots, onboarding, empty states. **Not the icon** — tested at 180/120/60/40, the bird + headphones + mic + waveform collapses into a smudge by 60px and is unreadable at 40px. |
  | `puffin-icon-source.png` | Head and beak, cream background flood-filled to transparent from the border only (a global colour key also punches out the white cheek, which is the same cream family). |
  | `puffin-icon-dark-1024.png` | **The icon.** Head on `--background` #06070A at a 72% inset, so iOS's rounded-square mask has margin to cut into. |
  | `puffin-icon-navy-1024.png` | Same on #0E1426. Kept as an alternate; it loses contrast at 40px and the dark one is the better mark. |

  The beak is the whole asset — it is the one shape nothing else on a home screen has,
  and it is what still reads at 40px in Spotlight and notifications.

  **Licensing gate:** the illustration is AI-generated. Before it becomes the App Store
  identity or gets filed as a trademark, confirm the generator's terms permit commercial
  use and registration. This blocks §6 step 2, not the display-text sweep.
- `EchoBriefActivityBundle.swift` — a Swift **type name**. Rename the struct and the file
  together; it is referenced by the widget bundle's `@main`.
- Notification copy, email templates, the share page's branding, and the App Store
  listing.

---

## 6. Order of operations

Each step is independently verifiable and leaves the tree working.

1. **Decide the bundle id question first** (§4a) — it constrains everything else.
2. Secure the name: App Store Connect, domain, IPOS trademark search.
3. Display-text sweep (§1), one area per commit.
4. Package rename (§3) + `bun install` + both typechecks.
5. Swift type and file rename (§5).
6. Assets and the new mark.
7. URL scheme (§4b) — **dual-allowlist release**, then drop the old scheme a release later.
8. Domain and `APP_URL` (§4d) — after the domain exists, never before.
9. Leave the bucket and the database alone (§4c, §4e).

**Verification gate at every step:** `npx tsc -p tsconfig.api.json --noEmit`,
`cd apps/mobile && npx tsc --noEmit`, `npm test` (currently 760/760), `npx eslint`.

---

## 7. What breaks if you rush it

Worth reading once before starting.

| Mistake | Consequence |
|---|---|
| Change bundle id after App Store launch | New app. Reviews, ratings and existing users left behind permanently. |
| Change URL scheme server-first | Google sign-in silently hangs for every installed app until they update. |
| Rename the R2 bucket | Every existing recording becomes unplayable — keys point at a bucket that no longer exists. |
| Edit applied migrations | `_migrations` desyncs; the next deploy either re-runs or skips wrongly. |
| Blind `sed` over `echobrief` lowercase | Silently rewrites the bundle id, scheme, and package names mid-sweep. |
| Change `APP_URL` before owning a domain | Every share link already sent to a colleague 404s. |
