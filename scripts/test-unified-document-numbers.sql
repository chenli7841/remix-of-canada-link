-- Run after 20261028170000; all generated counter values are rolled back.
BEGIN;
DO $$ DECLARE a text; b text; c text; failed boolean:=false;
BEGIN
  a:=public.gen_short_no('FW','08630','TM',now());
  b:=public.gen_short_no('FW','08630','TM',now());
  c:=public.gen_waybill_no('08630','TM','TOR','sea');
  IF a !~ '^FWTM08630[0-9]{9}$' OR c !~ '^SCTM08630[0-9]{9}$' OR a=b OR right(b,3)::int<>right(a,3)::int+1 THEN
    RAISE EXCEPTION 'Number format/sequence test failed';
  END IF;
  IF public.gen_short_no('FW','08630','HP','2026-10-29 02:00:00+00') !~ '^FWHP08630261028[0-9]{3}$' THEN
    RAISE EXCEPTION 'Toronto date test failed';
  END IF;
  a:=public.gen_short_no('FW','99999','ZZ','2099-01-01 12:00:00+00');
  UPDATE public.waybill_no_counters SET seq=999 WHERE scope_key='FWZZ9999920990101';
  b:=public.gen_short_no('FW','99999','ZZ','2099-01-01 12:00:00+00');
  IF right(b,3)<>'999' THEN RAISE EXCEPTION 'Last sequence test failed'; END IF;
  BEGIN
    PERFORM public.gen_short_no('FW','99999','ZZ','2099-01-01 12:00:00+00');
  EXCEPTION WHEN raise_exception THEN failed:=true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Quota limit test failed'; END IF;
END $$;
SELECT 'PASS: format, sequence, Toronto date, three-digit limit' AS verification;
ROLLBACK;
