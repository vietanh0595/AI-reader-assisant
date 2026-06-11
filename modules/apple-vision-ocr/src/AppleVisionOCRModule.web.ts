import { NativeModule, registerWebModule } from 'expo';

// AppleVisionOCRModule is not available on the web platform.
class AppleVisionOCRModule extends NativeModule {
  async recognizeText(): Promise<never> {
    throw new Error('Apple Vision OCR is only available on iOS.');
  }
}

export default registerWebModule(AppleVisionOCRModule, 'AppleVisionOCRModule');
