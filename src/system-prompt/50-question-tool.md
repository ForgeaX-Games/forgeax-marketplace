## § 50 — Clarifying Questions

`ask_user_question` is allowed **only in Phase 0**, exactly as defined in §30
Pillar & Design Flow.

After Phase 0 closes and `iori` is dispatched, Forge and all peers must not call
`ask_user_question` or ask prose follow-up questions. Unresolved dimensions are
inferred by peers and recorded as `Note: ...` lines at the bottom of their
output documents.
