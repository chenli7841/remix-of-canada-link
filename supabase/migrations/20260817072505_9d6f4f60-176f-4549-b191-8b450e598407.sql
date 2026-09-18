
CREATE OR REPLACE FUNCTION public.infer_material(_hs text, _name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH v AS (
    SELECT regexp_replace(coalesce(_hs,''), '\D', '', 'g') AS d,
           lower(coalesce(_name,'')) AS n
  )
  SELECT CASE
    WHEN v.n ~ '(stainless|不锈钢|ss )' THEN '不锈钢'
    WHEN substr(v.d,1,4) = '9617' THEN '不锈钢'
    WHEN substr(v.d,1,2) IN ('01','02','03','04','05','06','07','08','09','10','11','12','15','16','17','18','19','20','21','22') THEN '食品'
    WHEN substr(v.d,1,2) IN ('33','34') THEN '化学制剂'
    WHEN substr(v.d,1,2) = '39' THEN '塑料'
    WHEN substr(v.d,1,2) = '40' THEN '橡胶'
    WHEN substr(v.d,1,2) = '42' THEN CASE
        WHEN v.n ~ '(皮制|真皮|leather)' THEN '真皮'
        WHEN v.n ~ '(纺织|textile)' THEN '纺织物'
        WHEN v.n ~ '(塑料|plastic|pu)' THEN 'PU/塑料'
        ELSE '人造革' END
    WHEN substr(v.d,1,2) = '44' THEN '木制'
    WHEN substr(v.d,1,2) IN ('47','48','49') THEN '纸制'
    WHEN substr(v.d,1,2) IN ('50','51','52','53','54','55','56','57','58','59','60','63','65','66') THEN '纺织物'
    WHEN substr(v.d,1,2) IN ('61','62') THEN CASE
        WHEN v.n ~ '(棉|cotton)' THEN '棉'
        WHEN v.n ~ '(化纤|合纤|涤|synthetic|man-made|polyester)' THEN '化纤'
        WHEN v.n ~ '(羊毛|wool)' THEN '羊毛'
        ELSE '纺织物' END
    WHEN substr(v.d,1,2) = '64' THEN CASE
        WHEN v.n ~ '(皮|leather)' THEN '皮革'
        WHEN v.n ~ '(纺织|textile|布)' THEN '纺织物'
        WHEN v.n ~ '(塑|橡胶|rubber|plastic)' THEN '塑胶'
        ELSE '皮革/纺织混合' END
    WHEN substr(v.d,1,2) = '69' THEN '陶瓷'
    WHEN substr(v.d,1,2) = '70' THEN '玻璃'
    WHEN substr(v.d,1,2) = '71' THEN '金属/合金'
    WHEN substr(v.d,1,2) IN ('72','73') THEN '钢铁'
    WHEN substr(v.d,1,2) = '74' THEN '铜'
    WHEN substr(v.d,1,2) = '76' THEN '铝'
    WHEN substr(v.d,1,2) IN ('82','83') THEN '钢铁'
    WHEN substr(v.d,1,2) IN ('84','85','87','90','91','92') THEN '金属+塑料'
    WHEN substr(v.d,1,2) = '94' THEN CASE
        WHEN v.n ~ '(灯|lamp|light)' THEN '金属+塑料'
        WHEN v.n ~ '(木|wood)' THEN '木制'
        ELSE '金属+木+塑料' END
    WHEN substr(v.d,1,2) IN ('95','96') THEN '塑料'
    ELSE '混合材质'
  END
  FROM v;
$$;

UPDATE public.hs_codes
   SET material = public.infer_material(hs_code, coalesce(name_zh,'') || ' ' || coalesce(name_en,''))
 WHERE material IS NULL OR btrim(material) = '';

UPDATE public.hs_codes SET origin = 'China' WHERE origin IS NULL OR btrim(origin) = '';

UPDATE public.my_items m
   SET material = coalesce(
         nullif(btrim((SELECT h.material FROM public.hs_codes h
                        WHERE regexp_replace(h.hs_code,'\D','','g') = regexp_replace(coalesce(m.hs_code,''),'\D','','g')
                        LIMIT 1)), ''),
         public.infer_material(m.hs_code, m.name))
 WHERE material IS NULL OR btrim(material) = '';

UPDATE public.my_items SET origin = 'China' WHERE origin IS NULL OR btrim(origin) = '';

UPDATE public.customer_hs_items c
   SET material = coalesce(
         nullif(btrim((SELECT h.material FROM public.hs_codes h
                        WHERE regexp_replace(h.hs_code,'\D','','g') = regexp_replace(coalesce(c.hs_code,''),'\D','','g')
                        LIMIT 1)), ''),
         public.infer_material(c.hs_code, c.description))
 WHERE material IS NULL OR btrim(material) = '';

UPDATE public.customer_hs_items SET origin = 'China' WHERE origin IS NULL OR btrim(origin) = '';
