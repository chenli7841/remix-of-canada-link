
INSERT INTO public.app_settings (key, value) VALUES
('forwarding_warehouses', '{
  "guangzhou": {"name_zh":"广州仓","name_en":"Guangzhou","address_zh":"广东省广州市白云区机场路1234号 SinoCargo 集运仓 (收件人: SC广州仓 · 联系: 138-0000-1234)","address_en":"SinoCargo Guangzhou Warehouse, 1234 Airport Rd, Baiyun District, Guangzhou (Attn: SC-GZ · Tel: 138-0000-1234)"},
  "yiwu": {"name_zh":"义乌仓","name_en":"Yiwu","address_zh":"浙江省义乌市福田街道国际商贸城5区 SinoCargo 集运仓 (收件人: SC义乌仓 · 联系: 138-0000-5678)","address_en":"SinoCargo Yiwu Warehouse, Futian Int''l Trade City Zone 5, Yiwu, Zhejiang (Attn: SC-YW · Tel: 138-0000-5678)"}
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value) VALUES
('forwarding_routes', '{
  "guangzhou": [
    {"code":"GZ-AIR-YYZ","name_zh":"广州 → 多伦多 · 空运","name_en":"Guangzhou → Toronto · Air","destination_code":"YYZ","shipping_method":"air","eta_zh":"7-12 天","eta_en":"7-12 days","desc_zh":"标准空运专线，适合轻小高价值物品，到港后含末端派送","desc_en":"Standard air freight, ideal for small high-value items, last-mile included"},
    {"code":"GZ-AIR-YVR","name_zh":"广州 → 温哥华 · 空运","name_en":"Guangzhou → Vancouver · Air","destination_code":"YVR","shipping_method":"air","eta_zh":"7-12 天","eta_en":"7-12 days","desc_zh":"BC 线路，含末端派送","desc_en":"BC line, last-mile included"},
    {"code":"GZ-AIR-YUL","name_zh":"广州 → 蒙特利尔 · 空运","name_en":"Guangzhou → Montreal · Air","destination_code":"YUL","shipping_method":"air","eta_zh":"9-14 天","eta_en":"9-14 days","desc_zh":"QC 线路，仅限文件及小件","desc_en":"QC line, documents & small parcels"},
    {"code":"GZ-SEA-YYZ","name_zh":"广州 → 多伦多 · 海运","name_en":"Guangzhou → Toronto · Sea","destination_code":"YYZ","shipping_method":"sea","eta_zh":"35-45 天","eta_en":"35-45 days","desc_zh":"经济海运，适合家具、电器等大件","desc_en":"Economy sea freight, best for furniture & appliances"},
    {"code":"GZ-SEA-YVR","name_zh":"广州 → 温哥华 · 海运","name_en":"Guangzhou → Vancouver · Sea","destination_code":"YVR","shipping_method":"sea","eta_zh":"28-38 天","eta_en":"28-38 days","desc_zh":"西海岸海运，性价比之选","desc_en":"West-coast sea freight, value pick"}
  ],
  "yiwu": [
    {"code":"YW-AIR-YYZ","name_zh":"义乌 → 多伦多 · 空运","name_en":"Yiwu → Toronto · Air","destination_code":"YYZ","shipping_method":"air","eta_zh":"8-14 天","eta_en":"8-14 days","desc_zh":"小商品集运专线，单件不超过 30kg","desc_en":"Small-commodity consolidation, ≤30kg per parcel"},
    {"code":"YW-SEA-YYZ","name_zh":"义乌 → 多伦多 · 海运","name_en":"Yiwu → Toronto · Sea","destination_code":"YYZ","shipping_method":"sea","eta_zh":"40-50 天","eta_en":"40-50 days","desc_zh":"整柜出口经济线","desc_en":"Container economy line"},
    {"code":"YW-SEA-YVR","name_zh":"义乌 → 温哥华 · 海运","name_en":"Yiwu → Vancouver · Sea","destination_code":"YVR","shipping_method":"sea","eta_zh":"32-42 天","eta_en":"32-42 days","desc_zh":"西海岸海运专线","desc_en":"West-coast sea line"}
  ]
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE TABLE IF NOT EXISTS public.forwarding_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarding_id uuid NOT NULL REFERENCES public.forwarding_orders(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cny numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.forwarding_items TO authenticated;
GRANT ALL ON public.forwarding_items TO service_role;

ALTER TABLE public.forwarding_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fi_select_own" ON public.forwarding_items;
CREATE POLICY "fi_select_own" ON public.forwarding_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.forwarding_orders f WHERE f.id = forwarding_id AND f.user_id = auth.uid()));
DROP POLICY IF EXISTS "fi_insert_own" ON public.forwarding_items;
CREATE POLICY "fi_insert_own" ON public.forwarding_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.forwarding_orders f WHERE f.id = forwarding_id AND f.user_id = auth.uid()));
DROP POLICY IF EXISTS "fi_update_own" ON public.forwarding_items;
CREATE POLICY "fi_update_own" ON public.forwarding_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.forwarding_orders f WHERE f.id = forwarding_id AND f.user_id = auth.uid()));
DROP POLICY IF EXISTS "fi_delete_own" ON public.forwarding_items;
CREATE POLICY "fi_delete_own" ON public.forwarding_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.forwarding_orders f WHERE f.id = forwarding_id AND f.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_fi_fwd ON public.forwarding_items(forwarding_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fo_user_domestic_tracking
  ON public.forwarding_orders(user_id, domestic_tracking_no)
  WHERE domestic_tracking_no IS NOT NULL AND status <> 'cancelled';
