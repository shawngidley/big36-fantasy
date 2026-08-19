export const returnDistance = text => {
  const clean = String(text ?? '');
  return clean.match(/return(?:ed)?\s+(?:for\s+)?(\d+)\s+(?:yd(?:s)?|yards?)/i)?.[1]
    ?? clean.match(/(\d+)\s+(?:yd(?:s)?|yards?)\s+fumble\s+return/i)?.[1]
    ?? clean.match(/(\d+)\s+(?:yd(?:s)?|yards?)\s+return/i)?.[1]
    ?? null;
};
