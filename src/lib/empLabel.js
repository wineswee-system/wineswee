export const empLabel = (e) => e?.name_en ? `${e.name} (${e.name_en})` : (e?.name ?? '')
