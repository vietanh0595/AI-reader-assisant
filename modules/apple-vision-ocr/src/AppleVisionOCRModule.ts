import { NativeModule, requireNativeModule } from 'expo';

export type VisionBoundingBox = {
  height: number;
  unit: 'ratio';
  width: number;
  x: number;
  y: number;
};

export type VisionOcrBlock = {
  boundingBox: VisionBoundingBox;
  confidence: number;
  text: string;
};

export type VisionOcrResult = {
  author: string;
  blocks: VisionOcrBlock[];
  language: string | null;
  text: string;
  title: string;
};

declare class AppleVisionOCRModule extends NativeModule {
  recognizeText(imageUri: string): Promise<VisionOcrResult>;
}

export default requireNativeModule<AppleVisionOCRModule>('AppleVisionOCR');
