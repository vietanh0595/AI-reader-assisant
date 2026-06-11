Pod::Spec.new do |s|
  s.name           = 'AppleVisionOCR'
  s.version        = '1.0.0'
  s.summary        = 'On-device Apple Vision OCR for scanned book pages'
  s.description    = 'Recognizes and structures text locally with the Apple Vision framework.'
  s.author         = 'AI Book Reader'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.frameworks = 'Vision'
end
