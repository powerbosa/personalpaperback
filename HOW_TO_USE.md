# How to use this repository

## A. Paste this into Paperback 0.8

```
https://powerbosa.github.io/personalpaperback/
```

Paperback → **Settings → Extensions → Add Repository** → paste the URL above.

That is the base URL. Paperback finds `versioning.json` inside it by itself — don't
add `/versioning.json` to what you paste.

## B. Add a source

```bash
npm run add-source -- /path/to/MySource
git add -A && git commit -m "Add MySource" && git push
```

That's it. Pushing rebuilds, validates and redeploys automatically.

`add-source` refuses anything that would break the repository — wrong folder layout,
missing icon, missing metadata, or a Paperback 0.9 source. If it refuses, nothing is
copied and the repository is left exactly as it was.

## C. Remove a source

```bash
npm run remove-source -- MySource
git add -A && git commit -m "Remove MySource" && git push
```

To see what's installed: `npm run list-sources`

## D. Redeploy

Any push to the branch `claude/paperback-batcave-deploy-t4vsyo` redeploys.
To redeploy without changing anything:

GitHub → **Actions** → **Build, Validate & Deploy** → **Run workflow**

> The infrastructure currently lives on that branch, not on `main` — `main` still
> holds only the original README. The workflow is already configured to deploy from
> `main` as well, so if you merge the branch into `main`, everything keeps working
> and you can then just push to `main`. Nothing breaks if you don't merge.

## E. Check whether it worked

Open this on your phone:

```
https://powerbosa.github.io/personalpaperback/health.json
```

`"status": "ok"` means the repository is healthy. `sourceCount` tells you how many
extensions are live, and `lastDeploy` when it was built.

For detail, GitHub → **Actions** → newest run. A green tick means the live URL was
fetched and validated, not just that the build compiled.

## F. Roll back to the last working deployment

Every verified deployment is tagged. The most recent good one is always
`last-known-good`.

GitHub → **Actions** → **Build, Validate & Deploy** → **Run workflow** → change the
branch dropdown to the tag `last-known-good` → **Run workflow**.

Or from a terminal:

```bash
git fetch --tags
git reset --hard last-known-good
git push --force-with-lease
```

To roll back to a specific earlier deployment, `git tag --list 'deploy-*'` lists them
newest-last.

---

**If Paperback rejects the repository**, open `health.json` first. If it says `ok`, the
repository is fine and the problem is in the app — remove the repository in Paperback
and re-add it. Deeper technical detail is in `README.md`.
