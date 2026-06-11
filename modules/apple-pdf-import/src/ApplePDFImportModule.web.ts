import { NativeModule, registerWebModule } from 'expo';

class ApplePDFImportModule extends NativeModule {
  async extractDocument(): Promise<never> {
    throw new Error('Apple PDF import is only available on iOS.');
  }
}

export default registerWebModule(ApplePDFImportModule, 'ApplePDFImportModule');
