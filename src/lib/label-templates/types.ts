export type WaybillEntry = {
  waybill_no: string;
  weight_kg?: number | null;
  items_name?: string | null;
  chargeable_kg?: number | null;
  mark_no?: string | null;
};

export type LabelData = {
  entityType: "order" | "forwarding" | "carton" | "pallet" | "batch";
  entityNo: string;
  domesticTrackingNo?: string | null;
  parent?: any;
  waybills?: WaybillEntry[];
  address?: any;
  user?: any;
  total?: number;
  meta?: Record<string, any>;
};

export type LabelTemplate = (d: LabelData) => string;
