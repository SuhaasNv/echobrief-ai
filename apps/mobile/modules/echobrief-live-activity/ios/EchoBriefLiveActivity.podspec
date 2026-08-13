Pod::Spec.new do |s|
  s.name           = 'EchoBriefLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Recording Live Activity bridge.'
  s.description    = 'Starts, updates and ends the recording Live Activity from JS.'
  s.license        = 'UNLICENSED'
  s.author         = ''
  s.homepage       = 'https://github.com/expo/expo'

  # ActivityKit's floor is 16.1 and Activity.request(attributes:content:pushType:)
  # is 16.2. Matching the app's own 16.4 target keeps every ActivityKit symbol
  # unconditionally available, so nothing in this pod needs an #available dance.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
