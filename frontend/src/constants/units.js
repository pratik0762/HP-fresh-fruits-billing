// Single source of truth for packaging units across the ERP.
// Keep in sync with the Packaging Unit dropdown in Master Data → Fruit Items.
export const PACK_UNITS = ['PCS', 'BOX', 'BAG', 'GRAMS', 'KG', 'TONS'];

// Legacy/hardcoded units from older entry screens, kept so historical rows
// still render a valid option in unit dropdowns.
export const LEGACY_UNITS = ['crate', 'box', 'kg', 'dozen'];

// Builds the option list for entry-form unit dropdowns: master units first,
// then any custom unit saved on the loaded item masters (deduped, original case).
export const buildUnitOptions = (itemsList = []) => {
  const units = [...PACK_UNITS.map(u => u.toLowerCase()), ...LEGACY_UNITS];
  for (const itm of itemsList) {
    const u = itm?.packagingUnit?.trim();
    if (u && !units.includes(u.toLowerCase())) units.push(u);
  }
  return units;
};
