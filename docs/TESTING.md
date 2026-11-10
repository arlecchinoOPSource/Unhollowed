# Testing strategy

No UNHLW test suite or verified build commands exist yet. Establish real commands with the scaffold; CI should use least privilege and reviewed full-SHA action pins. Exercise host contracts, mounting and cleanup, genuine app workflows, keyboard and screen-reader behavior, focus, reduced motion, audio mute and failure, visual regressions and resize/text scaling. Measure frame time and memory on typical desktop hardware.

Use synthetic data to test migrations, backup/restore, interrupted and failed writes, older versions and simultaneous standalone/host processes. Verify packaging, install, startup, shutdown, updates and native permissions on actual macOS and Windows environments. Record commands, versions, results and platform evidence; browser tests do not prove native behavior. Track untested paths and defects explicitly.
