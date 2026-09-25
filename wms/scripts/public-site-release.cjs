// FIX: replace only the public React component in the verified published bundle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const web = path.resolve(__dirname, '../apps/web');
const fromWeb = createRequire(path.join(web, 'package.json'));
const fromVite = createRequire(fromWeb.resolve('vite/package.json'));
const { parseAst } = fromVite('rollup/parseAst');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function replaceLanding(source, build) {
  const ast = parseAst(source);
  const marker = 'Вид меню, заказы, склад и ТСД — без лишних переходов.';
  const matches = ast.body.filter(n => n.type === 'FunctionDeclaration' && source.slice(n.start, n.end).includes(marker));
  if (matches.length !== 1) throw new Error('Expected exactly one published landing component');
  const node = matches[0];
  const old = source.slice(node.start, node.end);
  if (node.id.name !== 'lD' || !old.startsWith('function lD({onLogin:t}){const n=x.useRef(null)') || !old.includes('e.jsx(')) throw new Error('Published React bindings changed');
  const prefix = source.slice(0, node.start), suffix = source.slice(node.end);
  const replacement = `let __logoffSite20260925;function lD(props){if(!__logoffSite20260925){const __logoffReact=x;${build}\n__logoffSite20260925=LogoffPublicSiteBuild.MarketingLanding;}return e.jsx(__logoffSite20260925,props);}`;
  const result = prefix + replacement + suffix;
  parseAst(result);
  if (result.slice(0, prefix.length) !== prefix || result.slice(prefix.length + replacement.length) !== suffix) throw new Error('Operational code changed');
  return { result, proof: { originalComponent: sha(old), unchangedPrefix: sha(prefix), unchangedSuffix: sha(suffix), originalBytes: Buffer.byteLength(source), resultBytes: Buffer.byteLength(result) } };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || fs.existsSync(output)) throw new Error('Usage: input bundle, new output directory');
  const source = fs.readFileSync(input, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../baselines/our-wms/2026-09-25-fbs-display/manifest.json')));
  const pinned = manifest.artifacts['web-runtime.tar.gz'].files['assets/index-yRhY3Ugi-age214.js'];
  if (sha(source) !== pinned) throw new Error('Input is not the pinned published bundle');
  const reactNames = 'Children Component Fragment Profiler PureComponent StrictMode Suspense cloneElement createContext createElement createFactory createRef forwardRef isValidElement lazy memo startTransition useCallback useContext useDebugValue useDeferredValue useEffect useId useImperativeHandle useInsertionEffect useLayoutEffect useMemo useReducer useRef useState useSyncExternalStore useTransition version'.split(' ');
  const built = await fromVite('esbuild').build({
    entryPoints: [path.join(web, 'src/components/MarketingLanding.tsx')], bundle: true, write: false,
    outfile: 'public-site.js', format: 'iife', globalName: 'LogoffPublicSiteBuild', minify: true,
    target: 'es2020', jsx: 'transform', jsxFactory: '__logoffReact.createElement', jsxFragment: '__logoffReact.Fragment',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    plugins: [{ name: 'existing-production-react', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'published-react' }));
      b.onLoad({ filter: /.*/, namespace: 'published-react' }, () => ({ contents: reactNames.map(k => `export const ${k}=__logoffReact.${k};`).join('\n') + '\nexport default __logoffReact;', loader: 'js' }));
      b.onResolve({ filter: /^\// }, args => ({ path: args.path, external: true }));
    } }],
  });
  const js = built.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = built.outputFiles.find(f => f.path.endsWith('.css')).text;
  const { result, proof } = replaceLanding(source, js);
  const originalIndex = fs.readFileSync(path.resolve(input, '../../index.html'), 'utf8');
  if (sha(originalIndex) !== manifest.artifacts['web-runtime.tar.gz'].files['index.html']) throw new Error('Index differs from the pinned release');
  // FIX: keep a single ESM/React instance; lazy chunks must import the new entry too.
  const assetDir = path.dirname(input);
  const available = Object.keys(manifest.artifacts['web-runtime.tar.gz'].files).filter(n => n.startsWith('assets/') && n.endsWith('.js')).map(n => n.slice(7));
  const queue = [path.basename(input)], graph = new Map();
  while (queue.length) {
    const name = queue.pop();
    if (graph.has(name)) continue;
    const content = fs.readFileSync(path.join(assetDir, name), 'utf8');
    if (sha(content) !== manifest.artifacts['web-runtime.tar.gz'].files['assets/' + name]) throw new Error('Chunk differs from baseline: ' + name);
    graph.set(name, content);
    for (const dependency of available) if (content.includes(dependency) && !graph.has(dependency)) queue.push(dependency);
  }
  const names = Object.fromEntries([...graph.keys()].map(n => [n, n === path.basename(input) ? 'index-public-light-20260925.js' : n.replace(/\.js$/, '-site20260925.js')]));
  const rewrite = text => text.replace(/[A-Za-z0-9_-]+\.js/g, name => names[name] || name);
  const index = originalIndex.replace('/assets/index-yRhY3Ugi-age214.js', '/assets/index-public-light-20260925.js').replace('</head>', '<link rel="stylesheet" href="/assets/public-light-20260925.css">\n  </head>');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'index.html'), index);
  const chunks = {};
  for (const [name, content] of graph) {
    const after = rewrite(name === path.basename(input) ? result : content);
    fs.writeFileSync(path.join(output, names[name]), after);
    chunks[names[name]] = { sha256: sha(after), original: name, originalSha256: sha(content), change: name === path.basename(input) ? 'public component and module URLs' : 'module URLs only' };
  }
  fs.writeFileSync(path.join(output, 'public-light-20260925.css'), css);
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify({ ...proof, baseBundle: pinned, indexSha256: sha(index), cssSha256: sha(css), chunks, scope: 'MarketingLanding only; other code unchanged except versioned module URLs' }, null, 2));
  console.log(JSON.stringify(proof));
}
module.exports = { replaceLanding, sha };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
