const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  value !== null
  && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
);

export const removeUndefinedFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => removeUndefinedFields(item)) as T;
  }

  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .map(([key, fieldValue]) => [key, removeUndefinedFields(fieldValue)])
  ) as T;
};
