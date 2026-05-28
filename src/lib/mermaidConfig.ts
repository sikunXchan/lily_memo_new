// Shared Mermaid initialisation. Both the note editor's MermaidComponent and
// the chat's MermaidPreview render with the same Lily theme, so the config
// lives here once — change the palette in a single place. `initMermaid()` is
// idempotent and safe to call from every module that renders a diagram.

import mermaid from 'mermaid';

let initialised = false;

export function initMermaid(): void {
  if (initialised) return;
  initialised = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#fce4ec',
      primaryTextColor: '#1a1a1a',
      primaryBorderColor: '#e84393',
      lineColor: '#e84393',
      secondaryColor: '#fff3e0',
      secondaryBorderColor: '#fb8c00',
      secondaryTextColor: '#1a1a1a',
      tertiaryColor: '#e3f2fd',
      tertiaryBorderColor: '#1976d2',
      tertiaryTextColor: '#1a1a1a',
      fontFamily: 'inherit',
    },
    securityLevel: 'loose',
    suppressErrors: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}
