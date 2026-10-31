// Which options of which fields are ticked: plain functions over { status: ['todo'], priority: ['urgent', 'high'] }.
/** Adds the value to the field's list, or takes it out when it is already there; a field with nothing left is dropped. */
export function toggleFilter(filter, field, value) {
  const current = filter[field] ?? [];
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  const { [field]: _removed, ...rest } = filter;
  return next.length ? { ...rest, [field]: next } : rest;
}

export function removeFilter(filter, field) {
  const { [field]: _removed, ...rest } = filter;
  return rest;
}

/** The filters that are on, as [field, values]; `known` names the fields the menu can show. */
export const appliedFilters = (filter, known) => Object.entries(filter).filter(([field, values]) => known.includes(field) && values?.length);
