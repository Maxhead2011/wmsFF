# Windows agent: relabel pairs and SOS WB 2 service labels

The published package 914c683b88a61973a4aa59556db5801fba90993f3fd421af72ee1af091de62fd
ignored the server `sortingLabel` image and drew a legacy English service label.
The API already supplies two identical target images for `TSD_RELABEL` jobs.

The repaired package combines both agreed behaviors:

- `TSD_RELABEL`: print the two identical target-product barcode images.
- SOS WB 2 / ordinary FBS: print the WB image and the server-rendered service
  label, with WMS request number, WB order number and warehouse.

The service rendering function is retained from commit c3f84a79 on
`fix/fbs-unified-sorting-label`; the agent does not define another template.
Both images are checked/decoded before the first print. Relabel images must
match. Success is acknowledged only after both printing calls return; failure
of the second call is reported as failure and does not reprint the first call.
Windows spooler acceptance cannot prove physical output; station 2409 must be
checked after installing the package.

Only the agent script entry changes in the ZIP. Setup, login, startup diagnostics,
generic SKU/box printing and other package entries are preserved. No API or DB
changes are included. Shared installations receive the agreed server service
image for normal FBS; only `TSD_RELABEL` selects the identical-target-pair rule.

Verification: `python -m unittest discover -s wms/print-agent/test -v` — 14 passed.
The new tests execute the real PowerShell job handler with fake print/API calls.
Before the relabel fix, five of six tests failed; after adding service-label
coverage, two tests failed until the agreed server-rendered function was restored.
The final suite covers two target labels, normal WB/service pairing, missing or
invalid second image, mismatched targets, and failure of the second print.
No actual print jobs or production data were created during the tests.

Install on the PC serving station 2409 using the existing setup/reconnect flow,
or replace its agent script and restart the existing scheduled task. Replacing
the server download alone does not update an already running Windows agent.
The prepared package has not yet been published or installed.
