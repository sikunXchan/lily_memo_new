import type { CSSProperties } from 'react';

// styled-jsx (Next 16 / React 19) does NOT add its scoping hash to a
// component's outermost element, so a `.overlay { position: fixed }` rule in a
// `<style jsx>` block silently fails to match the root and the modal collapses
// into normal document flow (rendering at the bottom of the page instead of
// covering the screen). We apply the full-screen overlay positioning inline
// instead, which always wins, and keep styled-jsx only for the inner (scoped)
// elements.
export const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)',
};
