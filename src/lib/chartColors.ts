// Default Chart.js dataset colors, applied when Lily's chart JSON omits its
// own backgroundColor. Shared by the chat block renderer (AIChat) and the
// Markdown→TipTap converter (charts embedded inside memo bodies).

export const CHART_PALETTE = [
  'rgba(255,99,132,0.75)', 'rgba(54,162,235,0.75)', 'rgba(255,206,86,0.75)',
  'rgba(75,192,192,0.75)', 'rgba(153,102,255,0.75)', 'rgba(255,159,64,0.75)',
  'rgba(231,76,60,0.75)', 'rgba(46,204,113,0.75)', 'rgba(52,152,219,0.75)',
];
const CHART_PALETTE_BORDER = CHART_PALETTE.map(c => c.replace('0.75', '1'));

export function autoColorChart(parsed: Record<string, unknown>): Record<string, unknown> {
  const data = parsed.data as { datasets?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(data?.datasets)) return parsed;
  const datasets = data!.datasets!.map((ds, i) => {
    if (ds.backgroundColor) return ds;
    const isPie = parsed.type === 'pie' || parsed.type === 'doughnut';
    return {
      ...ds,
      backgroundColor: isPie ? CHART_PALETTE : CHART_PALETTE[i % CHART_PALETTE.length],
      borderColor: isPie ? CHART_PALETTE_BORDER : CHART_PALETTE_BORDER[i % CHART_PALETTE_BORDER.length],
    };
  });
  return { ...parsed, data: { ...data, datasets } };
}
