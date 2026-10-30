declare module "citeproc" {
  const CSL: { Engine: new (sys: any, style: string, language?: string) => any };
  export default CSL;
}
declare module "*.csl?raw" { const text: string; export default text; }
declare module "*.xml?raw" { const text: string; export default text; }
