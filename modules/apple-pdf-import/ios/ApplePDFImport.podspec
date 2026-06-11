Pod::Spec.new do |s|
  s.name           = 'ApplePDFImport'
  s.version        = '1.0.0'
  s.summary        = 'On-device PDF import for AI Book Reader'
  s.description    = 'Extracts selectable PDF text with PDFKit and OCRs image-only pages with Vision.'
  s.author         = 'AI Book Reader'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.frameworks = 'PDFKit', 'Vision'
end
