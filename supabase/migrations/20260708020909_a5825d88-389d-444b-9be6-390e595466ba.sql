-- Declared value on "My Items" is CAD, not CNY.
ALTER TABLE public.my_items RENAME COLUMN declared_value_cny TO declared_value_cad;

-- Replace ensure_hs_code(): instead of silently no-op'ing on an existing code, resolve and
-- RETURN the authoritative rates so the client can overwrite whatever the customer typed.
-- New codes still get inserted using the customer-provided values (which then become
-- authoritative for everyone, same as before).
DROP FUNCTION IF EXISTS public.ensure_hs_code(text, text, text, numeric, numeric, boolean);

CREATE OR REPLACE FUNCTION public.resolve_hs_code_rates(
  p_hs_code text, p_name_zh text, p_unit text,
  p_mfn_rate numeric, p_gst_rate numeric, p_sima_involved boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.hs_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.hs_codes WHERE hs_code = p_hs_code;
  IF v_row.id IS NOT NULL THEN
    -- Existing code is staff-curated master data — it always wins over customer input.
    RETURN jsonb_build_object(
      'name_zh', v_row.name_zh, 'unit', v_row.unit,
      'mfn_rate', v_row.mfn_rate, 'gst_rate', v_row.gst_rate, 'sima_involved', v_row.sima_involved
    );
  END IF;

  INSERT INTO public.hs_codes (hs_code, chapter, name_zh, unit, mfn_rate, gst_rate, sima_involved, is_active)
  VALUES (
    p_hs_code, left(p_hs_code, 2), p_name_zh, p_unit,
    COALESCE(p_mfn_rate, 0), COALESCE(p_gst_rate, 0.05), COALESCE(p_sima_involved, false), true
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'name_zh', v_row.name_zh, 'unit', v_row.unit,
    'mfn_rate', v_row.mfn_rate, 'gst_rate', v_row.gst_rate, 'sima_involved', v_row.sima_involved
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_hs_code_rates(text, text, text, numeric, numeric, boolean) TO authenticated;
