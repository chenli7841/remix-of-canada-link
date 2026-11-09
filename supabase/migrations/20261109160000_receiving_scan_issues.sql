CREATE TABLE IF NOT EXISTS public.receiving_scan_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receiving_id uuid NOT NULL REFERENCES public.receivings(id) ON DELETE CASCADE,
 code text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
 matches jsonb NOT NULL DEFAULT '[]'::jsonb, operator_id uuid, scanned_at timestamptz NOT NULL DEFAULT now(), UNIQUE(receiving_id,code)
);
ALTER TABLE public.receiving_scan_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receiving_scan_issues FROM anon,authenticated;
GRANT ALL ON public.receiving_scan_issues TO service_role;
CREATE OR REPLACE FUNCTION public.record_receiving_scan_issue(_receiving_id uuid,_code text,_reason text,_operator_id uuid,_status text DEFAULT 'pending',_matches jsonb DEFAULT '[]'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r receivings%ROWTYPE;
BEGIN
 IF _operator_id IS NULL OR NOT is_staff(_operator_id) THEN RAISE EXCEPTION '没有收货操作权限'; END IF;
 SELECT * INTO r FROM receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('open','matched') THEN RAISE EXCEPTION '收货单已确认或不存在'; END IF;
 IF _status='pending' THEN
 INSERT INTO receiving_scan_issues(receiving_id,code,reason,operator_id,matches) VALUES(r.id,upper(trim(_code)),_reason,_operator_id,_matches)
 ON CONFLICT(receiving_id,code) DO UPDATE SET matches=excluded.matches,reason=excluded.reason,status='pending',operator_id=excluded.operator_id,scanned_at=now();
 ELSE
 UPDATE receiving_scan_issues SET status=_status WHERE receiving_id=r.id AND code=upper(trim(_code));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_receiving_scan_issue(uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_receiving_scan_issue(uuid,text,text,uuid,text,jsonb) TO service_role;
