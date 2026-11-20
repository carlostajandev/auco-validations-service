// "  Ana   Pérez " -> "Ana Pérez"
export const collapseSpaces = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

// "1.020.304-050" -> "1020304050"
export const normalizeDocument = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(/[\s.-]/g, '').toUpperCase()
    : value;

export const DOCUMENT_NUMBER_PATTERN = /^[A-Z0-9]{5,20}$/;
export const DOCUMENT_NUMBER_MESSAGE =
  'documentNumber must be 5-20 alphanumeric characters';
