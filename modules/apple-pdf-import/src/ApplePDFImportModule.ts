import { NativeModule, requireNativeModule } from 'expo';

export type PdfBoundingBox = {
  height: number;
  unit: 'ratio';
  width: number;
  x: number;
  y: number;
};

export type PdfImportBlock = {
  blockKind: 'body' | 'sectionHeading' | 'subheading';
  boundingBox: PdfBoundingBox;
  confidence?: number;
  text: string;
};

export type PdfImportPage = {
  blocks: PdfImportBlock[];
  pageIndex: number;
  pageLabel: string;
  usedOcr: boolean;
};

export type PdfImportResult = {
  author: string;
  outline: Array<{ pageIndex: number; title: string }>;
  pageCount: number;
  pages: PdfImportPage[];
  title: string;
};

declare class ApplePDFImportModule extends NativeModule {
  extractDocument(documentUri: string): Promise<PdfImportResult>;
}

export default requireNativeModule<ApplePDFImportModule>('ApplePDFImport');
