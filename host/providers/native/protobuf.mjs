// A reader for protobuf's wire format, with no schema: Antigravity keeps what a conversation holds as protobuf messages in its database and publishes no definition of them
// (antigravity-store.mjs). A message is read as the list of its fields; one that is not valid is an empty list, never an error, so that a store the vendor changed reads as "nothing
// found" and not as a crash.

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The fields of a message, in order: `{ number, wire, value }` where `value` is a number for a varint (an integer that does not fit one is `NaN`), and the bytes for anything
 * that is length-delimited. Fixed-size fields are skipped over, nothing here needs them.
 */
export function fieldsOf(bytes) {
  const fields = [];
  if (!bytes?.length) return fields;
  let at = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (at >= bytes.length) return undefined;
      const byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return Number.isSafeInteger(value) ? value : Number.NaN;
      scale *= 128;
    }
    return undefined;
  };
  while (at < bytes.length) {
    const key = varint();
    if (key === undefined || Number.isNaN(key)) return [];
    const number = Math.floor(key / 8);
    const wire = key % 8;
    if (number === 0) return [];
    if (wire === 0) {
      const value = varint();
      if (value === undefined) return [];
      fields.push({ number, wire, value });
    } else if (wire === 2) {
      const length = varint();
      if (length === undefined || Number.isNaN(length) || at + length > bytes.length) return [];
      fields.push({ number, wire, value: bytes.subarray(at, at + length) });
      at += length;
    } else if (wire === 1) { at += 8; } else if (wire === 5) { at += 4; } else return [];
    if (at > bytes.length) return [];
  }
  return fields;
}

/** The fields numbered `number`. */
export const allOf = (fields, number) => fields.filter((field) => field.number === number);

/** The message in the first length-delimited field numbered `number`, as its fields (none when it is not there or is not a message). */
export function messageOf(fields, number) {
  const field = fields.find((candidate) => candidate.number === number && candidate.wire === 2);
  return field ? fieldsOf(field.value) : [];
}

/** The text in the first length-delimited field numbered `number`, or '' (it is not there, or what is there is not text). */
export function stringOf(fields, number) {
  const field = fields.find((candidate) => candidate.number === number && candidate.wire === 2);
  if (!field) return '';
  try { return decoder.decode(field.value); } catch { return ''; }
}

/** The first varint numbered `number`, or undefined. */
export const numberOf = (fields, number) => fields.find((field) => field.number === number && field.wire === 0)?.value;
