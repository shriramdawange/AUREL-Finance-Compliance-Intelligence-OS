import { supabase } from "../lib/supabase";

export type KrushnaProductRow = {
  id:string; business_id:string; name:string; sku:string; barcode:string|null; hsn_sac:string|null;
  unit:string; selling_price:number; purchase_cost:number; gst_rate:number; stock_qty:number; reorder_level:number;
};
export type KrushnaPartyRow = {
  id:string; business_id:string; party_type:"customer"|"supplier"|"both"; name:string; gstin:string|null;
  phone:string|null; address:string|null; state_name:string|null; state_code:string|null;
};
const db=()=>{if(!supabase)throw new Error("Supabase is not configured");return supabase};
export const STATE_CODES:Record<string,string>={"Andhra Pradesh":"37","Arunachal Pradesh":"12","Assam":"18","Bihar":"10","Chhattisgarh":"22","Delhi":"07","Goa":"30","Gujarat":"24","Haryana":"06","Himachal Pradesh":"02","Jharkhand":"20","Karnataka":"29","Kerala":"32","Madhya Pradesh":"23","Maharashtra":"27","Manipur":"14","Meghalaya":"17","Mizoram":"15","Nagaland":"13","Odisha":"21","Punjab":"03","Rajasthan":"08","Sikkim":"11","Tamil Nadu":"33","Telangana":"36","Tripura":"16","Uttar Pradesh":"09","Uttarakhand":"05","West Bengal":"19"};
export async function loadWorkspace(businessId:string){
 const client=db();
 const [products,parties,invoices,purchases,moves,itc,tds]=await Promise.all([
  client.from("krushna_products").select("*").eq("business_id",businessId).eq("active",true).order("name"),
  client.from("krushna_parties").select("*").eq("business_id",businessId).order("name"),
  client.from("krushna_invoices").select("*,lines:krushna_invoice_lines(*)").eq("business_id",businessId).order("created_at",{ascending:false}),
  client.from("krushna_purchases").select("*").eq("business_id",businessId).order("created_at",{ascending:false}),
  client.from("krushna_stock_movements").select("*,product:krushna_products(name)").eq("business_id",businessId).order("occurred_at",{ascending:false}).limit(500),
  client.from("krushna_itc_records").select("*").eq("business_id",businessId).order("created_at",{ascending:false}),
  client.from("krushna_tds_records").select("*").eq("business_id",businessId).order("created_at",{ascending:false})
 ]);
 for(const r of [products,parties,invoices,purchases,moves,itc,tds])if(r.error)throw r.error;
 return {products:products.data||[],parties:parties.data||[],invoices:invoices.data||[],purchases:purchases.data||[],moves:moves.data||[],itc:itc.data||[],tds:tds.data||[]};
}
export async function saveProduct(businessId:string,p:Partial<KrushnaProductRow>){
 const {data,error}=await db().from("krushna_products").upsert({business_id:businessId,name:p.name,sku:p.sku,barcode:p.barcode||null,hsn_sac:p.hsn_sac||null,unit:p.unit||"Nos",selling_price:p.selling_price||0,purchase_cost:p.purchase_cost||0,gst_rate:p.gst_rate||0,stock_qty:p.stock_qty??0,reorder_level:p.reorder_level||0,...(p.id?{id:p.id}:{})},{onConflict:"business_id,sku"}).select().single();
 if(error)throw error;return data as KrushnaProductRow;
}
export async function saveParty(businessId:string,p:Partial<KrushnaPartyRow>){
 const {data,error}=await db().from("krushna_parties").upsert({business_id:businessId,party_type:p.party_type||"customer",name:p.name||"",gstin:p.gstin||null,phone:p.phone||null,address:p.address||null,state_name:p.state_name||null,state_code:p.state_code||STATE_CODES[p.state_name||""]||null,...(p.id?{id:p.id}:{})},{onConflict:"business_id,party_type,name"}).select().single();
 if(error)throw error;return data as KrushnaPartyRow;
}
export async function postInvoice(input:{businessId:string;stateCode:string;place:string;customerId:string|null;customerName:string;customerGstin:string;date:string;paid:number;lines:{product_id:string;quantity:number;discount:number}[]}){
 const fy=(()=>{const d=new Date(input.date),y=d.getFullYear(),m=d.getMonth();return m>=3?`${y}-${String(y+1).slice(-2)}`:`${y-1}-${String(y).slice(-2)}`})();
 const {data,error}=await db().rpc("krushna_post_invoice",{p_business_id:input.businessId,p_financial_year:fy,p_invoice_date:input.date,p_customer_id:input.customerId,p_customer_name:input.customerName,p_customer_gstin:input.customerGstin,p_place_of_supply:input.place,p_place_of_supply_code:STATE_CODES[input.place]||input.stateCode,p_reverse_charge:false,p_lines:input.lines,p_amount_paid:input.paid});
 if(error)throw error;return data as string;
}
export async function postPurchase(input:{businessId:string;supplierId:string|null;supplierName:string;invoiceNo:string;date:string;lines:{product_id:string;quantity:number;unit_cost:number}[]}){
 const {data,error}=await db().rpc("krushna_post_purchase",{p_business_id:input.businessId,p_supplier_id:input.supplierId,p_supplier_name:input.supplierName,p_supplier_invoice_no:input.invoiceNo,p_invoice_date:input.date,p_lines:input.lines});
 if(error)throw error;return data as string;
}

export async function saveItcRecord(businessId:string,input:{party:string;ref:string;date:string;taxable:number;tax:number;status:string}) {
 const {data,error}=await db().from("krushna_itc_records").insert({business_id:businessId,supplier_name:input.party,supplier_invoice_no:input.ref,invoice_date:input.date,taxable_value:input.taxable,cgst:0,sgst:0,igst:input.tax,source:"manual",reconciliation_status:input.status.toLowerCase().replaceAll(" ","_")}).select().single();
 if(error)throw error;return data;
}
export async function saveTdsRecord(businessId:string,input:{party:string;pan:string;section:string;date:string;base:number;rate:number}) {
 const {data,error}=await db().from("krushna_tds_records").insert({business_id:businessId,payee_name:input.party,payee_pan:input.pan||null,section:input.section,payment_date:input.date,base_amount:input.base,rate:input.rate,tds_amount:Math.round(input.base*input.rate)/100,certificate_status:"review"}).select().single();
 if(error)throw error;return data;
}
export async function updateBusiness(businessId:string,input:{name:string;gstin:string;address:string;state:string}) {
 const {error}=await db().from("krushna_businesses").update({trade_name:input.name,legal_name:input.name,gstin:input.gstin||null,address:input.address,state_name:input.state,state_code:STATE_CODES[input.state]||"27"}).eq("id",businessId);
 if(error)throw error;
}
