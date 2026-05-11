module HarnessCoverageHook
  def run_podfile_post_install_hooks
    super

    pods = resolve_coverage_pods
    return if pods.empty?

    Pod::UI.puts "[HarnessCoverage] Instrumenting pods for native coverage: #{pods.join(', ')}"

    apply_coverage_flags_to_pods(pods)
    enable_harness_coverage_pod
    apply_linker_flags
  end

  private

  def resolve_coverage_pods
    script = File.expand_path('resolve-coverage-pods.mjs', __dir__)
    pods_json = `NODE_OPTIONS="--preserve-symlinks" node #{script}`.strip
    JSON.parse(pods_json)
  rescue => e
    Pod::UI.warn "[HarnessCoverage] Failed to read config: #{e.message}"
    []
  end

  def apply_coverage_flags_to_pods(pods)
    pods_project.targets.each do |target|
      next unless pods.include?(target.name)

      target.build_configurations.each do |config|
        swift_flags = config.build_settings['OTHER_SWIFT_FLAGS'] || '$(inherited)'
        unless swift_flags.include?('-profile-generate')
          config.build_settings['OTHER_SWIFT_FLAGS'] =
            "#{swift_flags} -profile-generate -profile-coverage-mapping"
        end

        c_flags = config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
        unless c_flags.include?('-fprofile-instr-generate')
          config.build_settings['OTHER_CFLAGS'] =
            "#{c_flags} -fprofile-instr-generate -fcoverage-mapping"
        end
      end

      Pod::UI.puts "[HarnessCoverage]   -> #{target.name}"
    end
  end

  def enable_harness_coverage_pod
    pods_project.targets.each do |target|
      next unless target.name == 'HarnessCoverage'

      target.build_configurations.each do |config|
        swift_conditions = config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] || '$(inherited)'
        unless swift_conditions.include?('HARNESS_COVERAGE')
          config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] =
            "#{swift_conditions} HARNESS_COVERAGE"
        end

        gcc_defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || '$(inherited)'
        unless gcc_defs.include?('HARNESS_COVERAGE')
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] =
            "#{gcc_defs} HARNESS_COVERAGE=1"
        end
      end
    end
  end

  def apply_linker_flags
    pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        ldflags = config.build_settings['OTHER_LDFLAGS'] || '$(inherited)'
        unless ldflags.include?('-fprofile-instr-generate')
          config.build_settings['OTHER_LDFLAGS'] =
            "#{ldflags} -fprofile-instr-generate"
        end
      end
    end

    apply_app_target_linker_flags
  end

  def apply_app_target_linker_flags
    sandbox_root = config.sandbox.root
    target_support_dir = sandbox_root.join('Target Support Files')

    Dir.glob(target_support_dir.join('Pods-*', '*.xcconfig').to_s).each do |xcconfig_path|
      content = File.read(xcconfig_path)

      modified = false

      unless content.include?('-fprofile-instr-generate')
        content = content.gsub(
          /^(OTHER_LDFLAGS\s*=\s*)/,
          "\\1-fprofile-instr-generate "
        )
        modified = true
      end

      force_load = '-force_load "${PODS_CONFIGURATION_BUILD_DIR}/HarnessCoverage/libHarnessCoverage.a"'
      unless content.include?('libHarnessCoverage.a')
        content = content.gsub(
          /^(OTHER_LDFLAGS\s*=\s*)/,
          "\\1#{force_load} "
        )
        modified = true
      end

      if modified
        File.write(xcconfig_path, content)
        Pod::UI.puts "[HarnessCoverage]   -> patched #{File.basename(xcconfig_path)}"
      end
    end
  end
end

Pod::Installer.prepend(HarnessCoverageHook)
