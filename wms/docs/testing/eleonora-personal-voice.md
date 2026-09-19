# Personal assembly voice

Account: 8e175b30-8535-4881-9324-a875c9fd8c1d (existing personal welcome account, Элькапоне / Элеонора).

Only logoff selects personal resources. Other accounts retain bundled common voices. Voice objects are replaced on account changes. FBO and FBS/Ozon existing scan feedback keeps its existing silence rules for KIZ and background responses.

Repeat errors are per live voice session and action/error key: first uses MISS or ERROR, second and subsequent matching failures use REPEAT. Different failures start a new sequence. Explicit successful user actions clear the sequence; prompts and redraws do not. Closing a box remains announced only after persisted server acknowledgement. PUT combines the approved put recording, a short pause and the approved product-barcode recording.

Production is built over the published 196 source archive. Existing receipt, checkpoint and closure logic is preserved. API and web UI sources are unchanged. Release only updates signed Android download artifacts in the existing web image.

Tests: PersonalScanVoiceTest covers account/flavor isolation, each recording, second/third repeated failure, different failure, reset after success and unchanged other-user audio. Existing screen/acknowledgement and lifecycle suites are retained.
