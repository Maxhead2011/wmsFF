const fs = require('node:fs');

function restorePrintAckBinding(source) {
  // FIX: preserve the captured production module; restore only its missing CommonJS dependency.
  if (!/\bfbs_request_auto_status_1\./.test(source)) return source;
  const binding = 'const fbs_request_auto_status_1 = require("../../common/stock/fbs-request-auto-status");';
  if (/\b(?:const|let|var)\s+fbs_request_auto_status_1\b/.test(source)) {
    if (!source.includes(binding)) throw new Error('Unexpected auto-status binding; review the runtime');
    return source;
  }
  const strict = source.indexOf('"use strict";');
  const preamble = strict < 0 ? '' : source.slice(0, strict);
  if (strict < 0 || preamble.split(/\r?\n/).some(line => line.trim() &&
      !/^const\s+[\w{}\s,]+\s*=\s*require\((['"])[./\w-]+\1\);$/.test(line.trim()))) {
    throw new Error('Unexpected CommonJS wrapper; review the runtime');
  }
  return source.replace('"use strict";', '"use strict";\n' + binding);
}

module.exports = { restorePrintAckBinding };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output) throw new Error('Pass distinct input and candidate output paths');
  fs.writeFileSync(output, restorePrintAckBinding(fs.readFileSync(input, 'utf8')));
}
