-- Atomic role-permission replacement.
-- Replaces the two-round-trip delete+insert in setRolePermissions with a
-- single transaction so a network failure between the two calls can never
-- leave a role with no permissions.
CREATE OR REPLACE FUNCTION replace_role_permissions(
  p_role_id        BIGINT,
  p_permission_ids BIGINT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM role_permissions WHERE role_id = p_role_id;
  IF p_permission_ids IS NOT NULL AND array_length(p_permission_ids, 1) > 0 THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT p_role_id, unnest(p_permission_ids);
  END IF;
END;
$$;

-- Only service_role may call this function
REVOKE EXECUTE ON FUNCTION replace_role_permissions(BIGINT, BIGINT[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION replace_role_permissions(BIGINT, BIGINT[]) TO service_role;
