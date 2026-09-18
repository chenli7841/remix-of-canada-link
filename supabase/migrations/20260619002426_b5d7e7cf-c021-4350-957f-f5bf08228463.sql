
-- Move domestic tracking from waybill-level to order/forwarding-level

-- Orders: convert text column to array
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS domestic_tracking_nos text[] NOT NULL DEFAULT '{}';

UPDATE public.orders o SET domestic_tracking_nos =
  ARRAY(
    SELECT DISTINCT x FROM unnest(
      COALESCE(o.domestic_tracking_nos, '{}'::text[]) ||
      CASE WHEN o.domestic_tracking_no IS NOT NULL AND o.domestic_tracking_no <> ''
           THEN ARRAY[o.domestic_tracking_no] ELSE '{}'::text[] END ||
      COALESCE((SELECT array_agg(DISTINCT w.domestic_tracking_no)
                FROM public.waybills w
                WHERE w.order_id = o.id AND w.domestic_tracking_no IS NOT NULL AND w.domestic_tracking_no <> ''),
               '{}'::text[])
    ) AS t(x)
    WHERE x IS NOT NULL AND x <> ''
  );

ALTER TABLE public.orders DROP COLUMN IF EXISTS domestic_tracking_no;

-- Forwarding: backfill from waybills into existing array
UPDATE public.forwarding_orders f SET domestic_tracking_nos =
  ARRAY(
    SELECT DISTINCT x FROM unnest(
      COALESCE(f.domestic_tracking_nos, '{}'::text[]) ||
      COALESCE((SELECT array_agg(DISTINCT w.domestic_tracking_no)
                FROM public.waybills w
                WHERE w.forwarding_id = f.id AND w.domestic_tracking_no IS NOT NULL AND w.domestic_tracking_no <> ''),
               '{}'::text[])
    ) AS t(x)
    WHERE x IS NOT NULL AND x <> ''
  );

-- Remove domestic tracking from waybills (now order-level)
ALTER TABLE public.waybills DROP COLUMN IF EXISTS domestic_tracking_no;
