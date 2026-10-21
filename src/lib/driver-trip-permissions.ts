export async function canManageDriverTrips(db:any,userId:string):Promise<boolean> {
 const checks=await Promise.all(['owner','manager','warehouse_cn','warehouse_ca'].map(role=>db.rpc('has_role',{_user_id:userId,_role:role})));
 return checks.some(r=>!r.error&&r.data===true);
}
