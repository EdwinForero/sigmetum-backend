---
name: s3-operation-review
description: Checklist for reviewing or adding S3 operations (upload, delete, list, presigned URLs) in aws/awsS3connect.js. Use when touching S3 bucket logic, versioning, or presigned URL generation.
---

# S3 Operation Review Checklist

This project went through a bucket-layout and versioning refactor (see aws/awsS3connect.js, config/s3Paths.js, functions/getNextVersion.js). Keep new S3 work consistent with it.

1. **Path constants**: never hardcode S3 key prefixes — use/extend config/s3Paths.js.
2. **Presigned URL expiry**: confirm the expiry duration is explicit and reasonable (short-lived for write operations, longer only for read-only gallery/public content).
3. **Content-Type validation**: verify uploaded file MIME types/extensions are checked before upload, not trusted blindly from client input.
4. **Credentials**: confirm AWS credentials come from @aws-sdk/credential-providers (profile/role-based), never hardcoded keys — check config/validateEnv.js covers required AWS_* vars.
5. **Versioning**: if the operation creates/overwrites objects, confirm it goes through functions/getNextVersion.js rather than reinventing version logic.
6. **Error propagation**: S3 SDK errors (NoSuchKey, NoSuchBucket, AccessDenied, NetworkingError) should propagate via `next(error)` so middleware/errorHandler.js's `friendlyMessage` mapping applies — don't swallow or re-wrap them with a generic message.
7. **Least privilege**: new S3 actions should map to the minimal IAM permission needed (e.g. don't request `s3:*` for a read operation).
8. **Bucket name**: always reference `process.env.AWS_BUCKET_NAME`, never a literal bucket name.
9. **Docs**: update docs/05 and docs/06 in the same commit by following docs/guias/mantenimiento.md; if the version-name format or key layout changes, it is part of the frontend contract (section 6). Run `npm run docs:check`.
10. **Rules and rationale**: [one S3 convention (throw, paginate, parallelize)](../../../docs/guias/buenas-practicas-backend.md#5-s3-una-sola-convención), [time and versioning](../../../docs/guias/buenas-practicas-backend.md#6-tiempo-y-versionado), [S3 keys and injection](../../../docs/guias/seguridad.md#s4-claves-de-s3-e-inyección), [file uploads](../../../docs/guias/seguridad.md#s5-subida-de-archivos) and [S3 and IAM](../../../docs/guias/seguridad.md#s7-s3-e-iam).
