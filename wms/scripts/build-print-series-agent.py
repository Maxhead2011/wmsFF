"""Historical PR505 overlay: superseded by the complete Windows agent builder."""
# FIX: refuse to produce an incomplete package after lifecycle/journal modules were introduced.
raise SystemExit('Retired legacy builder. Use apps/windows-print-agent/Build-Package.ps1 for the complete agent package.')
