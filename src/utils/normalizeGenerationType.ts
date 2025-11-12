// Utility to normalize generationType values to canonical backend values
// Accepts legacy aliases and returns canonical string used for storage/indexing.
export function normalizeGenerationType(input?: string | string[]): string | string[] | undefined {
  if (!input) return input;
  const mapOne = (value: string): string => {
    const v = String(value || '').toLowerCase();
    switch (v) {
      case 'logo-generation':
        return 'logo';
      default:
        return v;
    }
  };
  if (Array.isArray(input)) return input.map((v) => mapOne(v));
  return mapOne(input);
}
