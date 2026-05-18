declare module 'html2pdf.js' {
  const html2pdf: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: (opt: Record<string, any>) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (el: Element) => any;
    save: () => Promise<void>;
  };
  export default html2pdf;
}
