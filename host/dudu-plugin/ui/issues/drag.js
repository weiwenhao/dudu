// Session status follows read receipts and foreground activity. Only workflow and priority are movable.
const DROP_FIELDS = ['status', 'priority'];
export const canDrop = (field, key) => DROP_FIELDS.includes(field) && key != null;
export const canDrag = (field) => DROP_FIELDS.includes(field);
export const wouldMove = (field, issue, key) => issue[field] !== key;
