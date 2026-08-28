# Provider Adapter Requirements

## Capability matrix

During discovery, build a matrix for every currently supported image model/provider:

- reference image supported?
- maximum reference image count?
- persistent handle/session supported?
- handle lifetime documented?
- style/reference weighting supported?
- accepted MIME and size?
- server fetch URL or binary upload?
- deterministic reuse?
- cost impact?
- safety/moderation requirements?

Do not claim statefulness from memory. Confirm from the installed SDK/official provider implementation available to the project.

## Normalized adapter contract

Conceptually:

```ts
prepareReferenceInputs({
  provider,
  model,
  characterAdoptions,
  worldAdoptions,
  providerState,
  limits
})
```

Returns:

- provider-specific inputs
- input mode per adoption
- new or refreshed provider handles
- omissions and reasons
- estimated extra cost if known

## Stateful path

- Reuse valid provider reference handle.
- Include concise description.
- Refresh or resend when handle is missing/expired.
- Store provider state encrypted or safely serialized according to current conventions.
- Provider state is replaceable cache, not canonical data.

## Stateless path

- Use canonical adopted reference.
- Resend only relevant references.
- Include description.
- Resize/convert through existing provider-aware image pipeline.
- Avoid sending original raw upload after canonical adoption unless a specific recovery flow requires it.

## Fallbacks

Recommended order:

1. valid provider handle
2. canonical adopted reference resend
3. description-only, only when enabled and user-visible consequences are acceptable
4. fail safely

Do not silently switch to a more expensive model or consume additional coins without established product behaviour.

## Model switching

If existing Kissago rules lock image model per story, retain that behaviour.

If an admin disables a model:

- existing stories should follow current fallback policy
- reference adoption state remains provider-neutral
- provider handles may be regenerated
- canonical assets and descriptions remain valid
