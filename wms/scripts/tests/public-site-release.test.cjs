// TEST: preserve every byte outside the presentation component; reject mismatched inputs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replaceLanding } = require('../public-site-release.cjs');
const marker = 'Вид меню, заказы, склад и ТСД — без лишних переходов.';
const old = `function lD({onLogin:t}){const n=x.useRef(null);return e.jsx('p',{children:'${marker}'})}`;
test('operational code remains byte-identical', () => {
  const prefix = 'const operationalOrders=42;';
  const suffix = 'function warehouse(){return operationalOrders}';
  const { result } = replaceLanding(prefix + old + suffix, 'var LogoffPublicSiteBuild={MarketingLanding:()=>null};');
  assert.ok(result.startsWith(prefix)); assert.ok(result.endsWith(suffix));
  assert.ok(result.includes('return e.jsx(__logoffSite20260925,props)'));
  assert.ok(!result.includes(marker));
});
test('missing or duplicate component cannot be released', () => {
  assert.throws(() => replaceLanding('const a=1;', ''), /exactly one/);
  assert.throws(() => replaceLanding(old + old.replace('function lD', 'function another'), ''), /exactly one/);
});
test('unknown React bindings cannot be released', () => {
  assert.throws(() => replaceLanding(old.replace('x.useRef', 'z.useRef'), ''), /bindings changed/);
});
