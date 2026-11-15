-- Trigger-only audit function must not be callable through the PostgREST RPC surface.
-- Trigger execution does not require the invoking application role to have EXECUTE.
revoke execute on function public.krushna_audit_row() from public, anon, authenticated;
