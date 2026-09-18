ALTER TABLE public.my_items
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'China',
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(12,3);

UPDATE public.my_items SET origin = 'China' WHERE origin IS NULL;

ALTER TABLE public.hs_codes
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'China';

UPDATE public.hs_codes SET origin = 'China' WHERE origin IS NULL;

ALTER TABLE public.customer_hs_items
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'China',
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(12,3);

UPDATE public.customer_hs_items SET origin = 'China' WHERE origin IS NULL;

CREATE OR REPLACE FUNCTION public.resolve_hs_code_rates(p_hs_code text, p_name_zh text, p_unit text, p_mfn_rate numeric, p_gst_rate numeric, p_sima_involved boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.hs_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.hs_codes WHERE hs_code = p_hs_code;
  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'name_zh', v_row.name_zh, 'unit', v_row.unit,
      'mfn_rate', v_row.mfn_rate, 'gst_rate', v_row.gst_rate, 'sima_involved', v_row.sima_involved,
      'material', v_row.material, 'origin', COALESCE(v_row.origin, 'China')
    );
  END IF;

  INSERT INTO public.hs_codes (hs_code, chapter, name_zh, unit, mfn_rate, gst_rate, sima_involved, is_active, origin)
  VALUES (
    p_hs_code, left(p_hs_code, 2), p_name_zh, p_unit,
    COALESCE(p_mfn_rate, 0), COALESCE(p_gst_rate, 0.05), COALESCE(p_sima_involved, false), true, 'China'
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'name_zh', v_row.name_zh, 'unit', v_row.unit,
    'mfn_rate', v_row.mfn_rate, 'gst_rate', v_row.gst_rate, 'sima_involved', v_row.sima_involved,
    'material', v_row.material, 'origin', COALESCE(v_row.origin, 'China')
  );
END;
$$;