-- personal_chargeable_weight_kg was the chargeable weight used by the OLD personal-freight
-- formula (bulk pack_* dims × box count, same as business). The 20260710001616 migration
-- rewrote the personal branch of _compute_line_quote to compute chargeable weight straight
-- from weight_kg/length_cm/width_cm/height_cm × quantity instead — this column has been
-- silently unread since then. last_mile_fee_cad (business-only) is untouched: it's still
-- read in _compute_line_quote's business branch and added to line_freight.
ALTER TABLE public.products DROP COLUMN IF EXISTS personal_chargeable_weight_kg;
