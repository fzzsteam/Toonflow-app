# OSS Mount Storage Design

**Date:** 2026-05-23
**Status:** Approved for planning

## Goal

Remove the app-level Aliyun OSS SDK storage path and use SAE-mounted filesystem directories instead.

SAE will use two separate persistent mounts:

- NAS for application data such as SQLite, skills, and assets.
- OSS mount for media files that previously lived under `data/oss`.

This keeps large media files out of NAS while avoiding direct OSS uploads from application code.

## Deployment Model

Recommended SAE environment:

```text
DATA_DIR=/mnt/nas/toonflow
OSS_MOUNT_DIR=/mnt/oss/toonflow
```

Directory ownership:

```text
/mnt/nas/toonflow/
  db2.sqlite
  assets/
  skills/

/mnt/oss/toonflow/
  uploaded and generated media files
  smallImage/
```

`DATA_DIR` continues to control the general Toonflow data root. `OSS_MOUNT_DIR` controls only the storage root used by `src/utils/oss.ts`.

## Architecture

`src/utils/getPath.ts` keeps its current `DATA_DIR` behavior:

- Electron: use the Electron user data directory.
- Non-Electron without `DATA_DIR`: use `<cwd>/data`.
- Non-Electron with `DATA_DIR`: use that resolved directory.

Add one shared media-root resolver used by both storage and HTTP serving:

```typescript
OSS_MOUNT_DIR ? path.resolve(OSS_MOUNT_DIR) : getPath("oss")
```

This resolver is the single source of truth for default media storage. It should create or validate the root directory during startup or `OSS` initialization, and startup logs should print the resolved path.

`src/utils/oss.ts` returns to local filesystem semantics:

- No `ali-oss` client.
- No `OSS_BUCKET`, `OSS_REGION`, `OSS_ACCESS_KEY_ID`, or `OSS_ACCESS_KEY_SECRET` branch.
- The root directory is `OSS_MOUNT_DIR` when set.
- Otherwise, the root directory is `getPath("oss")`.

The class still exposes the existing API used elsewhere in the app:

- `getFileUrl()`
- `getFile()`
- `getImageBase64()`
- `deleteFile()`
- `deleteDirectory()`
- `writeFile()`
- `fileExists()`
- `getSmallImageUrl()`

The `prefix` argument to `getFileUrl(userRelPath, prefix)` remains URL-prefix behavior only. It must not make `assets` or `skills` use `OSS_MOUNT_DIR`.

Directory boundaries:

- Default media files and generated thumbnails use the shared media root.
- `/assets/*` is still served from `getPath("assets")` under `DATA_DIR`.
- `/skills/*` is still served from `getPath("skills")` under `DATA_DIR`.
- `data/web` remains fixed inside the image and does not use `DATA_DIR`.

## HTTP Access

Express should always mount `/oss` as a static route backed by the same root used by `src/utils/oss.ts`.

When `OSS_MOUNT_DIR=/mnt/oss/toonflow`, URLs like:

```text
/oss/project-a/image.png
```

serve files from:

```text
/mnt/oss/toonflow/project-a/image.png
```

When `OSS_MOUNT_DIR` is not set, the same route serves from the original local path:

```text
<data root>/oss/project-a/image.png
```

This keeps URL behavior stable for the frontend and existing database records.

`/oss` is intentionally public in this design because the current app exposes static assets before JWT authentication. This is acceptable only if generated and uploaded media are considered shareable within the deployment. If media must be private, this design must change to a token-checked media route before implementation.

`/oss` should allow HTTP Range requests for video and audio playback unless a concrete regression is found. Large media files are a core use case, and disabling Range makes seeking and partial loading worse.

## Configuration Cleanup

Remove app-level OSS direct-upload configuration from code and deployment docs:

- `OSS_BUCKET`
- `OSS_REGION`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

Keep `ossURL` support only if it is still needed by existing URL generation behavior. If the app serves `/oss` from the same origin in SAE, `ossURL` can remain unset.

## Dependencies And Build

Remove the `ali-oss` package from `package.json` and `yarn.lock` if no other code uses it.

Remove build-only compatibility changes that existed solely for `ali-oss`, such as the `proxy-agent` external in the backend build, if that dependency is no longer referenced.

Docker and SAE deployment changes unrelated to direct OSS upload should stay:

- Multi-stage Docker build.
- `/api/health`.
- `CORS_ORIGIN`.
- fixed `data/web` static path.
- `DATA_DIR` support.

The server should also honor `process.env.PORT` with `10588` as the fallback, because SAE may inject a required port. Docker health checks should use the same configured port.

## Error Handling

Filesystem errors should surface normally for API handlers to handle or return:

- Missing files produce read/stat errors or `fileExists() === false`.
- Directory deletion checks still reject non-directory paths.
- Path traversal remains blocked by resolving paths under the configured OSS root.

`OSS_MOUNT_DIR` should be resolved to an absolute path before path safety checks.

## Data Initialization And Migration

NAS and OSS mounts may start empty. Deployment must account for both:

- NAS needs any required runtime data that is not in the image, including database files and app-managed `assets` or `skills` content.
- OSS mount needs existing media files from the previous `data/oss` directory or previous OSS bucket layout before the app is switched over.

The application will not rewrite existing database `filePath` values. Existing paths remain relative, so compatibility depends on the corresponding objects existing under the new media root.

SQLite on NAS remains a single-instance design. SAE instance count, scaling, and release strategy must avoid two app instances writing the same SQLite database at the same time.

## Testing

Verification should cover:

- TypeScript compile with `yarn lint`.
- Local fallback without `OSS_MOUNT_DIR`: files write under `data/oss`.
- Mounted-path mode with `OSS_MOUNT_DIR=/tmp/toonflow-oss-test`: write, read, URL generation, thumbnail generation, existence check, and delete all use that directory.
- Express `/oss` static route uses `OSS_MOUNT_DIR` when set.
- `/assets/ending.mp4` and `/skills/*` still resolve from `DATA_DIR`, not `OSS_MOUNT_DIR`.
- No remaining code references direct OSS SDK env vars or `ali-oss`.
- `PORT` env var is respected by the server and Docker health check.
- SAE mount smoke test: write, immediate read, overwrite, delete, directory delete, thumbnail generation, and concurrent reads on the actual OSS mount.

## Out Of Scope

- Rewriting existing database file path values.
- Multi-instance SQLite changes.
- Public bucket URL or signed URL support.
