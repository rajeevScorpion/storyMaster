# Storage, Privacy, Retention and Safety

## Storage classes

### Original source

- Private
- User-owned
- Never placed in public story payload
- Access through signed/internal mechanisms
- Separate retention policy
- Deletable subject to active adoption dependencies and product policy

### Canonical adopted reference

- Story asset
- Private by default
- May be used to render a published story
- Public delivery should use the resulting story image, not expose the source
- Follow existing compressed/HQ tier and retention rules where applicable

### Preview

- Optimized
- Private
- Short-lived or cacheable according to existing infrastructure

## Publishing

Publishing a story does not automatically publish:

- original uploads
- extracted raw metadata
- provider handles
- private canonical reference sheets

Only intended story outputs should be public.

## Ownership confirmation

Add concise confirmation that the user has rights/permission to use the uploaded image.

Store the accepted terms/version and timestamp if current product conventions support it.

## Sensitive inference

Avoid extracting or storing unnecessary sensitive attributes.

Descriptions should focus on visible depiction and continuity, not identity claims.

## Deletion

Define behaviour for:

- user removes upload before story begins
- user deletes source after canonical adoption
- user deletes story
- user deletes account
- retention expiry
- legal/moderation takedown

Do not leave orphaned private files.

## Signed URLs

- Short-lived
- Scoped
- Never logged
- Never stored as canonical database values
- Regenerated when needed

## Cloudflare/storage compatibility

Use existing storage abstraction and processing-mode settings.

Do not hard-code a new bucket/provider when current Cloudflare/R2 abstractions can support private prefixes and signed access.
