# 14 — Admin Processing Mode Toggle and Rollback Safety Net

## Purpose

The current Kissago image flow is already working: client-side image download/handling, client-side compression, and re-upload through the current cloud save method. The new server-side media pipeline should not replace it in one risky cutover. Implement a controlled processing-mode layer so admin can switch new generation jobs between the current legacy client flow and the new server-owned flow.

## Required modes

Implement an enum/config value such as:

```text
media_processing_mode = client_legacy | server_pipeline | hybrid_canary
```

### client_legacy

Uses the existing production behavior:
- browser receives/handles generated image data as currently implemented
- client-side compression continues as currently implemented
- existing cloud save/re-upload method remains active
- no server-side R2 compression pipeline is required for this mode

Use this as the default until server mode is explicitly enabled.

### server_pipeline

Uses the new durable server-side architecture:
- server creates generation job
- browser may close
- worker generates/fetches image
- original saved privately in Cloudflare R2
- compressed variants created server-side
- UI fetches ready display/thumbnail assets later
- HQ retention/export follows tier rules

### hybrid_canary, optional

Only implement if it fits the existing codebase safely. This mode can route a small percentage of new jobs or selected tiers/admin test accounts to `server_pipeline`, while the rest continue on `client_legacy`.

Do not implement canary if it will add too much complexity or risk. A simple two-mode admin switch is acceptable.

## Non-negotiable safety rules

- Do not remove the current client-side flow during initial implementation.
- The admin toggle must affect new jobs only.
- Existing generated stories must keep rendering exactly as before.
- Store the effective processing mode on every new job/media record.
- Do not create duplicate images when switching modes.
- Do not run client and server processing for the same image unless explicitly implementing a controlled migration/test path.
- Do not delete legacy saved assets automatically.
- Do not require redeploy to switch from server mode back to client legacy mode.

## Routing logic

When user starts generation:

```text
Read admin media_processing_mode
        ↓
Resolve effective mode
        ↓
Create job/media record with effective mode
        ↓
Route to matching processing flow
```

Suggested resolver:

```text
if mode == client_legacy:
    use current client flow

if mode == server_pipeline:
    use server worker flow

if mode == hybrid_canary:
    decide by admin percentage, tier, or allowlisted users
    store actual effective mode
```

## UI behavior

The user-facing story UI should not care which mode created the media. It should render through a normalized media response.

Example normalized media object:

```json
{
  "media_id": "...",
  "processing_mode": "client_legacy",
  "status": "ready",
  "display_url": "...",
  "thumbnail_url": "...",
  "hq_available": false
}
```

For server-generated media, `display_url` may come from R2/public derived assets or signed delivery depending on privacy.

For legacy media, `display_url` may come from the current cloud-save location.

## Admin UI requirements

Add an admin control named clearly, for example:

```text
Image Processing Mode
- Legacy client-side processing
- Server-side durable processing
- Hybrid/canary rollout, optional
```

Show warning text before enabling server-side globally:

```text
Server-side durable processing is a new media pipeline. Existing stories will remain unchanged. This setting affects new generation jobs only. You can switch back to legacy client-side processing if needed.
```

Show current active mode on the admin dashboard.

## Rollback plan

If server-side mode has issues:

1. Admin changes processing mode to `client_legacy`.
2. New generation jobs immediately use the existing client-side flow.
3. Existing completed server-generated stories continue to render from their saved R2 variants.
4. In-progress server jobs are allowed to finish, retried, or marked failed with a visible admin action depending on queue state.
5. No data is deleted.

## Testing checklist

- Legacy mode still works after new code is added.
- Server mode works when browser remains open.
- Server mode works when browser closes immediately after job creation.
- Switching from legacy to server affects only new jobs.
- Switching from server to legacy affects only new jobs.
- Old stories created before this feature still render.
- Server-generated stories still render after switching back to legacy mode.
- Admin cannot choose a disabled/unavailable mode.
- Failed server jobs are visible and can be retried/requeued.
- No duplicate media records are created for the same image generation request.

## Final instruction to AI coder

Treat this as a rollout safety layer, not as a permanent excuse to keep inconsistent behavior forever. The goal is to safely introduce server-side durable processing while preserving the current working system until production confidence is high.
