// server/helpers/family.ts
export type Family = "STRUCT" | "ARCH" | "MEP" | "OTHER";

const R_STRUCT = /(WALL|BEAM|COLUMN|SLAB|FLOOR|FOUNDATION|CURTAIN[_\s-]?WALL|STAIR|ROOF|CEILING)/i;
const R_ARCH   = /(DOOR|WINDOW|OPENING|FURNITURE|FINISH|BALUSTRADE|PARTITION)/i;
const R_MEP    = /(LIGHT|SPRINKLER|RECEPTACLE|DUCT|PIPE|CONDUIT|DIFFUSER|PANEL|MECH[_\s-]?EQUIP|ELECTRICAL|MECHANICAL|PLUMBING)/i;

export function familyOf(e:any): Family {
  const k = String(e?.elementType || e?.type || e?.category || e?.name || "");
  if (R_STRUCT.test(k)) return "STRUCT";
  if (R_ARCH.test(k))   return "ARCH";
  if (R_MEP.test(k))    return "MEP";
  return "OTHER";
}

export function countByFamily(arr:any[]){
  let STRUCT=0, ARCH=0, MEP=0, OTHER=0;
  for (const e of arr||[]) {
    const f = familyOf(e);
    if (f==="STRUCT") STRUCT++;
    else if (f==="ARCH") ARCH++;
    else if (f==="MEP") MEP++;
    else OTHER++;
  }
  return { STRUCT, ARCH, MEP, OTHER, BASE: STRUCT + ARCH };
}