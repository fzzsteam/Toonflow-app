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

## Error Handling

Filesystem errors should surface normally for API handlers to handle or return:

- Missing files produce read/stat errors or `fileExists() === false`.
- Directory deletion checks still reject non-directory paths.
- Path traversal remains blocked by resolving paths under the configured OSS root.

`OSS_MOUNT_DIR` should be resolved to an absolute path before path safety checks.

## Testing

Verification should cover:

- TypeScript compile with `yarn lint`.
- Local fallback without `OSS_MOUNT_DIR`: files write under `data/oss`.
- Mounted-path mode with `OSS_MOUNT_DIR=/tmp/toonflow-oss-test`: write, read, URL generation, thumbnail generation, existence check, and delete all use that directory.
- Express `/oss` static route uses `OSS_MOUNT_DIR` when set.
- No remaining code references direct OSS SDK env vars or `ali-oss`.

## Out Of Scope

- Changing existing database file path values.
- Moving existing objects between NAS and OSS.
- Multi-instance SQLite changes.
- Public bucket URL or signed URL support.
