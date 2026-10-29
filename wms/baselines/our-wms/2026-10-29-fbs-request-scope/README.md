# Published FBS request selection guard

PR767, 29.10.2026. LOGOFF TSD245 restores the selected request after a pending
operation; the API refuses unselected new assignments with
`WMS_FBS_EXPLICIT_REQUEST_ENABLED=true` only on our WMS.

Exactly one API module changed over PR765/PR766. All other 686 runtime modules,
the schema, existing 132 API feature flags and other environment variables are
preserved. Web changed only the three APK download files. No business-data repair.

`sourceParityVerified=false`: use this captured runtime for further overlays,
never a complete local source build. Public APK hashes and health verified.
Physical terminal installation/verification remains a separate step.
