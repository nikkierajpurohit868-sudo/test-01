declare module "dxf-parser" {
  export default class DxfParser {
    parseSync(text: string): any;
    parse(text: string): any;
  }
}
