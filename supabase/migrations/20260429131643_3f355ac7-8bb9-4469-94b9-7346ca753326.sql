REVOKE EXECUTE ON FUNCTION public.verify_extension_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_extension_token(TEXT) TO service_role;