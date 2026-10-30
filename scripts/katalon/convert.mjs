// Converts every Katalon test case of CDC-Katalon-Automation into a Playwright spec under tests/katalon/.
// Read-only on the Katalon project. Re-run after changing this converter or the Katalon scripts:
//   npm run katalon:convert
//
// Output:
//   support/katalon/object-repository.json   Object Repository (path → XPath), used by findTestObject()
//   tests/katalon/<test case path>.spec.ts    one spec per Katalon test case, the script translated line by line
//   .auth/katalon-variables.json              Username/Password (and IC) defaults from the .tc files (git-ignored)
//
// The translation is mechanical (Groovy → TypeScript) on top of support/katalon/runtime.ts, which implements the
// Katalon API (WebUI, findTestObject, TestObject, Keys, ...) on Playwright. Fix conversion issues here, not in the
// generated specs, so a re-run keeps them.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const katalonRoot = process.env.KATALON_DIR ?? path.resolve(root, '..', 'CDC-Katalon-Automation');
const outDir = path.join(root, 'tests', 'katalon');
const SKIP = new Set(['Update MOF Profile']); // already converted by hand: tests/mof/update-mof-profile.spec.ts

const read = (f) => fs.readFileSync(f, 'utf8');
const walk = (d, ext) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name), ext) : e.name.endsWith(ext) ? [path.join(d, e.name)] : []);
const decodeXml = (s) => s.replace(/&#xd;|&#xa;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, t) => xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
const tags = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]);

/* ---------- Object Repository ---------- */

const orRoot = path.join(katalonRoot, 'Object Repository');
const repository = {};
for (const file of walk(orRoot, '.rs').sort()) {
  const xml = read(file);
  const method = tag(xml, 'selectorMethod') ?? 'BASIC';
  const selector = decodeXml(xml.match(new RegExp(`<key>${method}</key>\\s*<value>([^<]*)</value>`))?.[1] ?? '').trim();
  const key = path.relative(orRoot, file).split(path.sep).join('/').replace(/\.rs$/, '');
  repository[key] = { method, selector };
}
/** Object Repository locators that no longer match SIT, found by running the specs. Listed in katalon-script-defects.md. */
const OBJECT_REPAIRS = [
  {
    key: 'Direct LOA/2. Direct LOA Supplier/Zone Item/Zone Item Supplier Product/Item Details Pop Up Item Details - OK',
    find: "normalize-space()='OK']",
    replace: "normalize-space()='OK' or normalize-space()='Yes']",
    note: 'Item Details confirmation now has Yes/No instead of OK ("Are you sure with this code assignment?"); accept either',
  },
];
const objectRepairs = [];
for (const r of OBJECT_REPAIRS) {
  if (!repository[r.key]?.selector.includes(r.find)) throw new Error(`Object repair no longer applies: ${r.key}`);
  repository[r.key].selector = repository[r.key].selector.split(r.find).join(r.replace);
  objectRepairs.push(r);
}
fs.writeFileSync(path.join(root, 'support', 'katalon', 'object-repository.json'), JSON.stringify(repository, null, 1) + '\n');

/* ---------- Test cases, variables, suite data bindings ---------- */

const tcRoot = path.join(katalonRoot, 'Test Cases');
const testCases = walk(tcRoot, '.tc').sort().map((f, i) => {
  const rel = path.relative(tcRoot, f).split(path.sep).join('/').replace(/\.tc$/, '');
  const xml = read(f);
  const variables = tags(xml, 'variable').map((v) => ({ id: tag(v, 'id'), name: tag(v, 'name'), def: decodeXml(tag(v, 'defaultValue') ?? '') }));
  return { id: `KAT-${String(i + 1).padStart(3, '0')}`, rel, variables };
});

const dataFiles = {};
for (const f of walk(path.join(katalonRoot, 'Data Files'), '.dat')) {
  const xml = read(f);
  const id = 'Data Files/' + path.relative(path.join(katalonRoot, 'Data Files'), f).split(path.sep).join('/').replace(/\.dat$/, '');
  dataFiles[id] = { source: decodeXml(tag(xml, 'dataSourceUrl') ?? ''), sheet: decodeXml(tag(xml, 'sheetName') ?? '') };
}
const bindings = {}; // test case rel → [binding]
for (const f of walk(path.join(katalonRoot, 'Test Suites'), '.ts')) {
  const xml = read(f);
  const suite = path.relative(path.join(katalonRoot, 'Test Suites'), f).split(path.sep).join('/').replace(/\.ts$/, '');
  for (const link of tags(xml, 'testCaseLink')) {
    const rel = tag(link, 'testCaseId')?.replace(/^Test Cases\//, '');
    const dl = tags(link, 'testDataLink')[0];
    if (!rel || !dl) continue;
    const dataFile = tag(dl, 'testDataId');
    const linkId = tag(dl, 'id');
    const tc = testCases.find((t) => t.rel === rel);
    const columns = {};
    for (const vl of tags(link, 'variableLink')) {
      if (tag(vl, 'type') !== 'DATA_COLUMN' || tag(vl, 'testDataLinkId') !== linkId) continue;
      const v = tc?.variables.find((x) => x.id === tag(vl, 'variableId'));
      if (v) columns[v.name] = decodeXml(tag(vl, 'value'));
    }
    (bindings[rel] ??= []).push({ suite, dataFile, ...(dataFiles[dataFile] ?? { source: '', sheet: '' }), columns });
  }
}

/* ---------- Groovy → TypeScript ---------- */

const RUNTIME_EXPORTS = ['WebUI', 'findTestObject', 'TestObject', 'ConditionType', 'FailureHandling', 'Keys', 'WebUiCommonHelper',
  'WebElement', 'By', 'DriverFactory', 'KeywordUtil', 'println', 'gAssert', 'groovyMatcher', 'groovyFullMatch', 'Arrays', 'System',
  'Thread', 'SimpleDateFormat', 'LocalDate', 'DateTimeFormatter', 'File', 'Paths', 'Files', 'FileInputStream', 'FileOutputStream',
  'XSSFWorkbook', 'katalonMissing', 'binding'];
const WEB_HELPER_SRC = path.join(katalonRoot, 'Keywords', 'common', 'WebHelper.groovy');
const WEB_HELPER_NAMES = [...read(WEB_HELPER_SRC).matchAll(/^\s*static\s+\S+\s+(\w+)\s*\(/gm)].map((m) => m[1]);
/**
 * Repairs to Katalon script steps that only worked by timing, found by running the specs on SIT.
 * Applied to the Groovy source before conversion; listed in knowledge/katalon-script-defects.md.
 */
const SELECT_SUPPLIER = "c(findTestObject('Object Repository/Direct LOA/1. Direct LOA Requistioner/Search Supplier From Requistioner/Select Supplier'), 20)";
const REPAIRS = [
  {
    find: SELECT_SUPPLIER,
    replace: `if (!WebUI.waitForElementNotVisible(findTestObject('Object Repository/Direct LOA/1. Direct LOA Requistioner/Search Supplier From Requistioner/Select Supplier'), 3, FailureHandling.OPTIONAL)) ${SELECT_SUPPLIER}`,
    note: 'Supplier popup: the double-click on the supplier row already selects it and closes the popup, so "Select" is clicked only if the popup is still open 3 s later (it raced before)',
  },
  {
    // LOAs over RM500,000 a year open a GST notice on the supplier's Zone / Item page that blocks the Assign buttons.
    when: (tc) => /Supplier/.test(tc.rel),
    find: /^((?:c|WebUI\.click)\(findTestObject\('Object Repository\/Direct LOA\/1\. Direct LOA Requistioner\/Side Menu\/Side Menu Zone Item'\)\)[^\n]*)$/m,
    replace: `$1
TestObject gstNoticeOk = new TestObject('gstNoticeOk')
gstNoticeOk.addProperty('xpath', ConditionType.EQUALS, "//div[contains(@class,'ui-dialog') and @aria-hidden='false' and contains(.,'register GST')]//button[.//span[normalize-space()='OK']]")
if (WebUI.waitForElementVisible(gstNoticeOk, 3, FailureHandling.OPTIONAL)) c(gstNoticeOk, 20)`,
    note: 'Zone / Item: an LOA over RM500,000 a year shows a GST registration notice (OK) that blocks the Assign buttons; click OK if it appears',
  },
  {
    // uploadFilePath is declared inside `if (agreementValue == 2) {` but the LOA signer upload uses it always.
    when: (tc) => tc.rel.includes('/6. Open/'),
    find: /^(\s+)String uploadFilePath = (System\.getProperty\("user\.dir"\) \+ "\/TestData\/UploadFiles\/File_pdf_for_testing\.pdf")/m,
    replace: '$1uploadFilePath = $2',
    prepend: 'String uploadFilePath = System.getProperty("user.dir") + "/TestData/UploadFiles/File_pdf_for_testing.pdf"\n',
    note: '"uploadFilePath" was declared only in the Agreement = No branch but used by the LOA signer upload in every run; declared once at the top',
  },
  {
    // Typo: the script reads ZonalCoverage, the test case defines ZoneCoverage.
    when: (tc) => tc.variables.some((v) => v.name === 'ZoneCoverage') && !tc.variables.some((v) => v.name === 'ZonalCoverage'),
    find: 'ZonalCoverage',
    replace: 'ZoneCoverage',
    note: 'Script reads variable "ZonalCoverage" but the test case defines "ZoneCoverage" (typo); reads ZoneCoverage',
  },
];

/** Found by typechecking the converted specs: the Katalon scripts use these where they are not defined. */
const UNDEFINED_IN_KATALON = ['uploadFilePath', 'ZonalCoverage', 'SupplierName1', 'SupplierName2', 'SupplierName3', 'DaytoResponse',
  'submitBtn', 'checkDocumentStillAvailableToClaim'];
const HELPERS = ['toInt', 'waitBlockUI', 'wVisible', 'wClickable', 'c', 'dc', 't', 'setZoneQtyByRow', 'setUnitPriceByRow', 'up',
  'openPFDropdown', 'clickPFOptionByIndex', 'selectDropdownByIndex'];
/** Methods that are async on Playwright-backed objects (WebElement, workbook, driver). */
const ASYNC_METHODS = ['click', 'getText', 'getAttribute', 'getTagName', 'isDisplayed', 'isEnabled', 'isSelected', 'clear',
  'sendKeys', 'findElements', 'findElement', 'executeScript', 'write'];

/** Replace strings and comments with \u0000n\u0000 tokens so code rewrites can't touch them. */
function protect(src) {
  const store = [];
  let out = '';
  let i = 0;
  const put = (kind, text) => {
    store.push({ kind, text });
    return `\u0000${store.length - 1}\u0000`;
  };
  const prevCode = () => out.replace(/\s+$/, '').slice(-3);
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      out += put('comment', src.slice(i, j));
      i = j;
    } else if (two === '/*') {
      const j = src.indexOf('*/', i + 2) + 2;
      out += put('comment', src.slice(i, j));
      i = j;
    } else if (three === '"""' || three === "'''") {
      const j = src.indexOf(three, i + 3);
      out += put(three === '"""' ? 'gstring' : 'string', src.slice(i + 3, j));
      out = out.replace(/\u0000(\d+)\u0000$/, (m, n) => ((store[n].multiline = true), m));
      i = j + 3;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') j += 2;
        else if (ch === '"' && src.slice(j, j + 2) === '${') (depth++, (j += 2));
        else if (depth && src[j] === '}') (depth--, j++);
        else if (!depth && src[j] === ch) break;
        else j++;
      }
      out += put(ch === '"' ? 'gstring' : 'string', src.slice(i + 1, j));
      i = j + 1;
    } else if (ch === '/' && /(=~|==~|\(|,|=)$/.test(prevCode()) && src.slice(i + 1).match(/^[^\n/]+\/(?![/*])/)) {
      const m = src.slice(i).match(/^\/((?:\\.|[^\n/\\])+)\//);
      out += put('regex', m[1]);
      i += m[0].length;
    } else {
      out += ch;
      i++;
    }
  }
  return { code: out, store };
}

function restore(code, store) {
  return code.replace(/\u0000(\d+)\u0000/g, (_, n) => {
    const { kind, text, multiline } = store[n];
    if (kind === 'comment') return text;
    if (kind === 'regex') return `/${text}/`;
    if (kind === 'string') {
      if (multiline) return '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
      return `'${text}'`;
    }
    // Groovy GString → template literal when it interpolates ($x or ${...}), else a plain string.
    const interpolates = /(?<!\\)\$(\{|[A-Za-z_])/.test(text);
    if (!interpolates && !multiline) return `"${text}"`;
    let t = text.replace(/`/g, '\\`');
    if (multiline) t = t.replace(/\\(?![$"\\nrt'])/g, '\\\\');
    t = t.replace(/(?<![\\{])\$([A-Za-z_][\w.]*)/g, (m, id) => '${' + id.replace(/\.$/, '') + '}' + (id.endsWith('.') ? '.' : '')).replace(/\\\$/g, '$');
    return '`' + t + '`';
  });
}

/** Index of the bracket matching the one at `open` (code is string-free). */
function matching(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

const norm = (code, store) => code.replace(/\u0000(\d+)\u0000/g, (m, n) => (store[n].kind === 'comment' ? '' : store[n].text)).replace(/\s+/g, '');

/** Top-level `def name(...) {...}` and `def name = {...}` blocks: [{name, start, end}] */
function functionBlocks(code) {
  const out = [];
  const re = /^(?:def|void|String|boolean|int|TestObject|WebElement)\s+(\w+)\s*(?:\([^)]*\)|=)\s*\{/gm;
  for (let m; (m = re.exec(code)); ) {
    const open = m.index + m[0].length - 1;
    const end = matching(code, open);
    if (end > 0) out.push({ name: m[1], start: m.index, end: end + 1 });
  }
  return out;
}

const canonicalSrc = read(walk(path.join(katalonRoot, 'Scripts', '1. Direct LOA Script (PK7) - QT', '5. Verify', 'DO Verify LOA'), '.groovy')[0]);
const canonical = (() => {
  const { code, store } = protect(canonicalSrc);
  return Object.fromEntries(functionBlocks(code).filter((b) => HELPERS.includes(b.name)).map((b) => [b.name, norm(code.slice(b.start, b.end), store)]));
})();

const TYPE = String.raw`(?:def|var|final|int|long|double|float|boolean|char|byte|short|[A-Z][\w.]*(?:<[^=()\n]*?>)?(?:\[\])?)`;
const params = (p) => p.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [decl, dflt] = s.split(/\s*=\s*/);
  const name = decl.trim().split(/\s+/).at(-1);
  return `${name}: any${dflt !== undefined ? ` = ${dflt}` : ''}`;
}).join(', ');

function convert(src, opts = {}) {
  let { code, store } = protect(src.replace(/\r\n/g, '\n'));
  const notes = [];

  // `import static common.WebHelper.*` → the Keywords/common/WebHelper.groovy functions (support/katalon/web-helper.ts).
  const webHelper = /import\s+static\s+common\.WebHelper\.\*/.test(code) ? WEB_HELPER_NAMES : [];
  // Imports anywhere in the script.
  code = code.replace(/^[ \t]*import\s+[^\n]*$/gm, '');

  // Browser setup (Katalon starts its own Chrome; the Playwright fixture provides the page).
  code = code.replace(/^String chromeBinary[\s\S]*?DriverFactory\.changeWebDriver\(driver\)[^\n]*$/m, '// (Katalon Chrome setup removed: the Playwright fixture opens the browser)');
  code = code.replace(/^\s*WebUI\.openBrowser\([^\n]*$/gm, '');

  // Helpers identical to the shared Katalon helpers → imported from support/katalon/helpers.ts.
  const imported = new Set();
  const blocks = functionBlocks(code);
  for (const b of [...blocks].reverse()) {
    if (!opts.keepHelpers && canonical[b.name] && canonical[b.name] === norm(code.slice(b.start, b.end), store)) {
      code = code.slice(0, b.start) + `// ${b.name}: shared helper, see support/katalon/helpers.ts` + code.slice(b.end);
      imported.add(b.name);
    }
  }
  const defined = new Set(functionBlocks(code).map((b) => b.name));
  for (const m of code.matchAll(/^\s*(?:def|void|String|boolean|int|TestObject|WebElement|List\S*)\s+(\w+)\s*\(/gm)) defined.add(m[1]);

  // Multi-line asserts → one line.
  code = code.replace(/^(\s*assert\b[^\n]*?)(?:\s*\n\s*)(?=:|&&|\|\||\+|\u0000)/gm, '$1 ');
  code = code.replace(/^(\s*assert\b[^\n]*?(?::|&&|\|\||\+))\s*\n\s*/gm, '$1 ');
  code = code.replace(/^(\s*)assert\s+(.+?)(?:\s+:\s+(.+?))?(\s*\u0000\d+\u0000)?$/gm, (_, ind, cond, msg, tail = '') => {
    // A trailing token may be a // comment (stays after the call) or the end of the message.
    const comment = tail && store[tail.trim().slice(1, -1)].kind === 'comment';
    if (!comment && tail) msg ? (msg += tail) : (cond += tail);
    return `${ind}gAssert(${cond}${msg ? `, ${msg}` : ''})${comment ? ' ' + tail.trim() : ''}`;
  });
  // new TestObject(id).tap { addProperty(...) } → new TestObject(id).addProperty(...)
  for (let m; (m = /\.tap\s*\{\s*(?=addProperty\s*\()/.exec(code)); ) {
    const end = matching(code, m.index + m[0].indexOf('{'));
    code = code.slice(0, m.index) + '.' + code.slice(m.index + m[0].length, end).trim() + code.slice(end + 1);
  }

  // Groovy map literals [k: v, ...] → object literals.
  for (let i = code.length - 1; i >= 0; i--) {
    if (code[i] !== '[') continue;
    const end = matching(code, i);
    if (end < 0) continue;
    const inner = code.slice(i + 1, end);
    if (/^\s*(?:\u0000\d+\u0000|[A-Za-z_]\w*)\s*:(?!:)/.test(inner)) code = code.slice(0, i) + '{' + inner + '}' + code.slice(end + 1);
  }
  // Collection closures: .collect { it.trim() } → .map((it: any) => (it.trim())), .findAll → filter, ...
  const JS_ITER = { collect: 'map', findAll: 'filter', find: 'find', any: 'some', every: 'every' };
  for (let m; (m = /\.(collect|findAll|find|any|every)\s*\{/.exec(code)); ) {
    const open = m.index + m[0].length - 1;
    const end = matching(code, open);
    let inner = code.slice(open + 1, end).trim();
    let p = 'it';
    const arrow = inner.match(/^([\w\s,]+?)\s*->/);
    if (arrow) {
      p = arrow[1].split(',').map((s) => s.trim().split(/\s+/).at(-1)).join(', ');
      inner = inner.slice(arrow[0].length).trim();
    }
    const fn = inner.includes('\n') ? `{ ${inner} }` : `(${inner})`;
    code = code.slice(0, m.index) + `.${JS_ITER[m[1]]}((${p.split(', ').map((x) => `${x}: any`).join(', ')}) => ${fn})` + code.slice(end + 1);
  }
  // map.each { k, v -> } → for (const [k, v] of Object.entries(map))
  code = code.replace(/([\w$.\]\[\u0000]+(?:\([^()]*\))?)\.each\s*\{\s*(?:\w+\s+)?(\w+)\s*,\s*(?:\w+\s+)?(\w+)\s*->/g, 'for (const [$2, $3] of Object.entries($1)) {');

  // catch (Exception e) / catch (A | B e)
  code = code.replace(/catch\s*\(\s*[\w.|\s]+?\s+(\w+)\s*\)/g, 'catch ($1: any)');
  // for loops
  code = code.replace(/for\s*\(\s*(?:final\s+)?(?:def|int|long|Integer)\s+(\w+)\s*=/g, 'for (let $1 =');
  code = code.replace(/for\s*\(\s*(?:final\s+)?(?:[\w<>[\].]+\s+)?(\w+)\s*(?::|\bin\b)\s*([^;)]+(?:\([^;)]*\))?[^;)]*)\)/g, 'for (const $1 of $2)');
  // .each / .eachWithIndex closures → for…of (the closure's closing brace closes the loop)
  code = code.replace(/([\w$.\]\[\u0000]+(?:\([^()]*\))?)\.eachWithIndex\s*\{\s*(?:\w+\s+)?(\w+)\s*,\s*(?:\w+\s+)?(\w+)\s*->/g, 'for (const [$3, $2] of ($1).entries()) {');
  code = code.replace(/([\w$.\]\[\u0000]+(?:\([^()]*\))?)\.each\s*\{\s*(?:(?:[\w<>]+\s+)?(\w+)\s*->)?/g, (_, coll, v) => `for (const ${v ?? 'it'} of ${coll}) {`);
  // Closures assigned to variables → async arrow functions.
  code = code.replace(/^(\s*)(?:def|final|Closure)\s+(\w+)\s*=\s*\{\s*([^{}\n]*?)\s*->/gm, (_, ind, n, p) => {
    defined.add(n);
    return `${ind}const ${n} = async (${params(p)}) => {`;
  });
  // Method definitions → async functions.
  // Groovy coerces arguments to numeric parameter types (clickZoneLocRadio(int option) called with "2" from Excel);
  // JS doesn't, and switch/=== then miss. Convert those parameters to numbers on entry.
  const numericParams = (p) => p.split(',').map((s) => s.trim().split(/\s*=\s*/)[0].split(/\s+/)).filter((w) => w.length === 2 && /^(int|Integer|long|Long|double|Double|BigDecimal)$/.test(w[0])).map((w) => w[1]);
  code = code.replace(/^(\s*)(?:(?:private|public|static)\s+)*(?:def|void|String|boolean|Boolean|int|Integer|long|double|Object|TestObject|WebElement|List(?:<[^>\n]*>)?|Map(?:<[^>\n]*>)?)\s+(\w+)\s*\(([^)\n]*)\)\s*\{/gm,
    (_, ind, n, p) => `${ind}async function ${n}(${params(p)}) {${numericParams(p).map((x) => ` if (${x} != null) ${x} = Number(${x});`).join('')}`);
  // Local variable declarations.
  code = code.replace(new RegExp(String.raw`^(\s*)(?:final\s+)?${TYPE}\s+(\w+)\s*=(?!=)`, 'gm'), (m, ind, n) => (/^(return|else|new|throw)$/.test(n) ? m : `${ind}let ${n}: any =`));
  code = code.replace(new RegExp(String.raw`^(\s*)(?:final\s+)?${TYPE}\s+(\w+)\s*$`, 'gm'), (m, ind, n) => (/^(return|else)$/.test(n) ? m : `${ind}let ${n}: any`));
  code = code.replace(/^(\s*)def\s+(\w+)/gm, '$1let $2: any');
  code = code.replace(/(\{\s*|;\s*)(?:String|int|def|boolean)\s+(\w+)\s*=/g, '$1let $2: any =');

  // Groovy / Java expressions.
  code = code
    .replace(/\(\s*(?:int|Integer|long|double|String|TestObject|WebElement|List(?:<[^>]*>)?)\s*\)\s*(?=[\w(\u0000])/g, '')
    .replace(/\s+as\s+(?:String|int|Integer|List|TestObject|WebElement|long|double|BigDecimal)\b/g, '')
    .replace(/new\s+(?:ArrayList|LinkedList)(?:<[^>]*>)?\s*\(\s*\)/g, '[]')
    .replace(/new\s+(?:HashMap|LinkedHashMap)(?:<[^>]*>)?\s*\(\s*\)|\[\s*:\s*\]/g, '{}')
    .replace(/new\s+BigDecimal\s*\(/g, 'Number(')
    .replace(/new\s+(?:\w+\.)*\w*(?:Exception|Error)\s*\(/g, 'new Error(')
    .replace(/Object\.entries\(/g, 'Object.entries<any>(')
    .replace(/String\.valueOf\s*\(/g, 'String(')
    .replace(/Integer\.(?:parseInt|valueOf)\s*\(/g, 'parseInt(')
    .replace(/Double\.(?:parseDouble|valueOf)\s*\(/g, 'parseFloat(')
    .replace(/\.getMessage\(\)/g, '.message')
    // Java String.replace(a, b) replaces every occurrence, literally; Groovy replaceAll takes a regex.
    .replace(/\.replaceAll\s*\(\s*(\u0000\d+\u0000)\s*,/g, (m, s) => (store[s.slice(1, -1)].kind === 'regex' ? m : `.replace(new RegExp(${s}, 'g'),`))
    .replace(/\.replace\s*\((?=\s*\u0000)/g, '.replaceAll(')
    .replace(/\.length\(\)/g, '.length')
    .replace(/(\w+)\.printStackTrace\(\)/g, 'console.error($1)')
    .replace(/\?:/g, '||')
    .replace(/\b(\d+)[Ll]\b/g, '$1')
    .replace(/([\w$.]+(?:\([^()]*\))*)\s+in\s+(\[[^\]\n]*\])/g, '$2.includes($1)')
    .replace(/(\(?[\w$.]+(?:\([^()]*\))*\)?)\s*==~\s*(\u0000\d+\u0000)/g, 'groovyFullMatch($1, $2)')
    .replace(/([\w$.]+(?:\([^()]*\))*)\s*=~\s*(\u0000\d+\u0000)/g, 'groovyMatcher($1, $2)')
    .replace(/^(\s*)println\s+(?!\()(.+)$/gm, '$1println($2)')
    .replace(/^(\s*)WebUI\.comment\s+(?!\()(.+)$/gm, '$1WebUI.comment($2)');
  // Groovy string regexes passed to =~ as strings
  code = code.replace(/groovyMatcher\(([^,]+), (\u0000\d+\u0000)\)/g, (m, a, s) => m);

  // Names the Katalon script uses where Groovy can't see them (never declared, or declared in another block):
  // Katalon stops there with MissingPropertyException; katalonMissing() does the same unless KAT_<name> is set.
  for (const n of UNDEFINED_IN_KATALON) {
    if (opts.variables?.includes(n)) continue;
    const decls = [...code.matchAll(new RegExp(String.raw`\b(?:let|const|function)\s+${n}\b`, 'g'))].map((m) => {
      let depth = 0;
      let i = m.index;
      for (; i >= 0; i--) {
        if (code[i] === '}') depth++;
        else if (code[i] === '{' && depth-- === 0) break;
      }
      return { from: m.index, to: i < 0 ? code.length : matching(code, i) };
    });
    const re = new RegExp(String.raw`(?<![\w$.])${n}\b(?!\s*:)`, 'g');
    const uses = [...code.matchAll(re)].filter((m) => !decls.some((d) => m.index >= d.from && m.index <= d.to));
    for (const m of uses.reverse()) code = code.slice(0, m.index) + `katalonMissing('${n}')` + code.slice(m.index + n.length);
    if (uses.length) notes.push(`"${n}" is used where the Katalon script does not define it`);
  }

  // await every Katalon/async call; parenthesise when the result is used (".trim()" etc.).
  const asyncNames = new Set([...defined, ...imported, ...webHelper]);
  const callRe = new RegExp(String.raw`(?<![\w$.])(?:(?:WebUI|WebUiCommonHelper|Thread)\.\w+|${[...asyncNames].join('|') || '\u0001'})\s*\(|(?<![\w$])[\w$]+(?:\.[\w$]+|\[[^\]\n]*\]|\(\))*\.(?:${ASYNC_METHODS.join('|')})\s*\(`, 'g');
  const calls = [...code.matchAll(callRe)].map((m) => ({ start: m.index, open: m.index + m[0].length - 1 }));
  for (const { start, open } of calls.reverse()) {
    const before = code.slice(Math.max(0, start - 16), start);
    if (/(function\s+|await\s+|async\s+|new\s+)$/.test(before)) continue;
    const callee = code.slice(start, open).trim();
    if (/^(?:Keys|KeywordUtil)\./.test(callee)) continue;
    if (/\.(?:click|clear|write|getAttribute|getText)$/.test(callee) && /^(?:this)\./.test(callee)) continue;
    const close = matching(code, open);
    if (close < 0) continue;
    const after = code.slice(close + 1);
    const usedAsValue = /^\s*(?:\.|\[|\?\.)/.test(after);
    code = usedAsValue
      ? code.slice(0, start) + '(await ' + code.slice(start, close + 1) + ')' + code.slice(close + 1)
      : code.slice(0, start) + 'await ' + code.slice(start);
  }

  // `def x = WebUI.waitFor... ? ...` and friends are fine; arrow callbacks with await need async.
  code = code.replace(/\b(\w+)\s*=>\s*(?=[^{\n]*\bawait\b)/g, 'async $1 => ');

  let ts = restore(code, store);
  ts = ts.replace(/\n{3,}/g, '\n\n').trim();
  const bare = ts.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const uses = (n) => new RegExp(String.raw`(?<![\w$.])${n}\b`).test(bare);
  const usedRuntime = RUNTIME_EXPORTS.filter(uses);
  const webHelperUsed = webHelper.filter((n) => !defined.has(n) && uses(n));
  return { ts, usedRuntime, helpers: [...imported].filter(uses), webHelperUsed, notes };
}

/* ---------- Specs ---------- */

const scriptFor = (rel) => {
  const dir = path.join(katalonRoot, 'Scripts', ...rel.split('/'));
  return fs.existsSync(dir) ? walk(dir, '.groovy').find((f) => path.dirname(f) === dir) : undefined;
};
const literal = (groovy) => {
  const v = groovy.trim();
  if (v === '') return 'undefined';
  if (/^'(?:[^'\\]|\\.)*'$/.test(v) || /^"(?:[^"\\$]|\\.)*"$/.test(v)) return JSON.stringify(v.slice(1, -1).replace(/\\(.)/g, '$1'));
  if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/.test(v)) return v;
  return `undefined /* Katalon default: ${v.replace(/\*\//g, '* /')} */`;
};
const value = (groovy) => {
  const v = groovy.trim();
  if (/^'(?:[^'\\]|\\.)*'$/.test(v) || /^"(?:[^"\\$]|\\.)*"$/.test(v)) return v.slice(1, -1).replace(/\\(.)/g, '$1');
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
};
const SECRET = /^(username|password)$|(^|_)ic$/i;
const ROLES = [[/supplier/i, 'Supplier'], [/receiving officer/i, 'Receiving Officer'], [/acknowledge officer/i, 'Acknowledge Officer'],
  [/approv/i, 'Approver'], [/do verify/i, 'Desk Officer'], [/payment/i, 'Finance / Payment'],
  [/requ?is?i?tioner|requestioner|prepare|add to/i, 'Requisitioner']];

if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
const secrets = {};
const report = [];
const defects = [];
for (const tc of testCases) {
  if (SKIP.has(tc.rel)) continue;
  const script = scriptFor(tc.rel);
  if (!script) {
    report.push(`${tc.id} ${tc.rel}: no script, skipped`);
    continue;
  }
  let groovy = read(script);
  const repaired = [];
  for (const r of REPAIRS) {
    if (r.when && !r.when(tc)) continue;
    if (r.find instanceof RegExp) {
      if (!r.find.test(groovy)) continue;
      groovy = (r.prepend ?? '') + groovy.replace(r.find, r.replace);
    } else {
      if (!groovy.includes(r.find)) continue;
      groovy = groovy.split(r.find).join(r.replace);
    }
    repaired.push(r.note);
  }
  const { ts, usedRuntime, helpers, webHelperUsed, notes } = convert(groovy, { variables: tc.variables.map((v) => v.name) });
  notes.push(...repaired.map((n) => `REPAIRED: ${n}`));
  const parts = tc.rel.split('/');
  const name = parts.at(-1);
  const specFile = path.join(outDir, ...parts.slice(0, -1), `${name}.spec.ts`);
  const up = path.relative(path.dirname(specFile), root).split(path.sep).join('/') || '.';
  const binding = bindings[tc.rel]?.[0];
  const otherBindings = (bindings[tc.rel] ?? []).slice(1);

  const defaults = tc.variables.filter((v) => !SECRET.test(v.name));
  const secretVars = tc.variables.filter((v) => SECRET.test(v.name));
  if (secretVars.length) secrets[tc.id] = Object.fromEntries(secretVars.map((v) => [v.name, value(v.def)]).filter(([, x]) => x !== undefined));

  const names = tc.variables.map((v) => v.name);
  const role = ROLES.find(([re]) => re.test(name))?.[1] ?? 'TBD';
  const body = ts.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
  const spec = `// GENERATED by scripts/katalon/convert.mjs from the Katalon project. Change the converter, not this file.
import { test, scenario } from '${up}/fixtures/katalon';
import { katalonVariables${usedRuntime.length ? ', ' + usedRuntime.join(', ') : ''} } from '${up}/support/katalon/runtime';
${helpers.length ? `import { ${HELPERS.filter((h) => helpers.includes(h)).join(', ')} } from '${up}/support/katalon/helpers';\n` : ''}${webHelperUsed.length ? `import { ${webHelperUsed.join(', ')} } from '${up}/support/katalon/web-helper';\n` : ''}
/*
 * Katalon: Test Cases/${tc.rel}.tc
 * Script:  ${path.relative(katalonRoot, script).split(path.sep).join('/')}
 * Data:    ${binding ? `suite "${binding.suite}" → ${binding.dataFile} (${path.win32.basename(binding.source)}, sheet "${binding.sheet}")` : 'test case defaults (no suite binds a data file)'}${otherBindings.map((b) => `\n *          also suite "${b.suite}" → ${b.dataFile}`).join('')}
 *
 * DATA-CHANGING on SIT/UAT unless the script only reads.${notes.map((n) => (n.startsWith('REPAIRED: ') ? `\n * Katalon step repaired: ${n.slice(10)}.` : `\n * Katalon defect kept as is: ${n} (fails there, as in Katalon).`)).join('')}
 */
test.describe('${tc.id} ${name.replace(/'/g, "\\'")}', () => {
  test(
    ${JSON.stringify(name)},
    scenario({
      cr: 'KATALON',
      id: '${tc.id}',
      module: ${JSON.stringify(parts.slice(0, -1).join(' / ') || parts[0])},
      role: '${role}',
      tags: ['@katalon'],
      expected: 'Proposed — Pending QA Review: the Katalon flow completes as in Katalon Studio',
    }),
    async () => {
    test.setTimeout(60 * 60_000);
    // eslint-disable-next-line prefer-const
    let { ${names.join(', ')} }: Record<string, any> = await katalonVariables('${tc.id}', {
${defaults.map((v) => `      ${v.name}: ${literal(v.def)},`).join('\n')}
    }${binding ? `, ${JSON.stringify({ suite: binding.suite, dataFile: binding.dataFile, source: binding.source, sheet: binding.sheet, columns: binding.columns })}` : ''});

${body}
    },
  );
});
`;
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, spec);
  report.push(`${tc.id} ${tc.rel} → ${path.relative(root, specFile)} (${ts.split('\n').length} lines${helpers.length ? `, ${helpers.length} shared helpers` : ''})`);
  for (const n of notes) defects.push({ id: tc.id, rel: tc.rel, note: n });
}

fs.mkdirSync(path.join(root, '.auth'), { recursive: true });
fs.writeFileSync(path.join(root, '.auth', 'katalon-variables.json'), JSON.stringify(secrets, null, 2) + '\n');

// Shared helpers (the block every Katalon script repeats), from the DO Verify LOA script.
{
  const { code, store } = protect(canonicalSrc);
  const src = functionBlocks(code).filter((b) => HELPERS.includes(b.name)).map((b) => code.slice(b.start, b.end)).join('\n\n');
  const { ts, usedRuntime } = convert(src.replace(/\u0000(\d+)\u0000/g, (_, n) => {
    const s = store[n];
    return s.kind === 'comment' ? s.text : s.kind === 'regex' ? `/${s.text}/` : s.multiline ? `"""${s.text}"""` : s.kind === 'gstring' ? `"${s.text}"` : `'${s.text}'`;
  }), { keepHelpers: true });
  fs.writeFileSync(path.join(root, 'support', 'katalon', 'helpers.ts'), `// GENERATED by scripts/katalon/convert.mjs: the helper functions every Katalon script defines
// (wait for BlockUI, click with retry, PrimeFaces dropdown by index, ...), converted once and shared.
// A script whose copy differs keeps its own version inline.
import { ${usedRuntime.join(', ')} } from './runtime';

${ts.replace(/^(async function|const) /gm, 'export $1 ')}
`);
}

// Keywords/common/WebHelper.groovy (class of static helpers) → support/katalon/web-helper.ts
{
  const body = read(WEB_HELPER_SRC).replace(/\r\n/g, '\n').replace(/^package[^\n]*\n/m, '')
    .replace(/^class\s+WebHelper\s*\{/m, '').replace(/\}\s*$/, '')
    .replace(/^\t/gm, '').replace(/^static\s+(?:def|boolean|int|String)\s+/gm, 'def ');
  const { ts, usedRuntime } = convert(body, { keepHelpers: true });
  fs.writeFileSync(path.join(root, 'support', 'katalon', 'web-helper.ts'), `// GENERATED by scripts/katalon/convert.mjs from Keywords/common/WebHelper.groovy
// (used by scripts with \`import static common.WebHelper.*\`).
import { ${usedRuntime.join(', ')} } from './runtime';

${ts.replace(/^(async function|const) /gm, 'export $1 ')}
`);
}

fs.writeFileSync(path.join(root, 'knowledge', 'katalon-script-defects.md'), `# Katalon script defects found during conversion

Generated by \`npm run katalon:convert\`. Each line is a place where the Katalon script uses a name it does not
define (or defines in another block), so Katalon itself stops there with MissingPropertyException /
MissingMethodException. The Playwright spec keeps that behaviour: \`katalonMissing()\` throws the same way, unless the
value is supplied with \`KAT_<name>\` (for test data such as SupplierName1).

Lines marked REPAIRED are Katalon steps that only worked by timing; the converter changes them (REPAIRS in
scripts/katalon/convert.mjs) so the Playwright run is reliable.

| Scenario | Katalon test case | Defect |
|---|---|---|
${defects.map((d) => `| ${d.id} | ${d.rel} | ${d.note} |`).join('\n')}

## Object Repository locators repaired (OBJECT_REPAIRS)

| Object | Change |
|---|---|
${objectRepairs.map((r) => `| ${r.key} | ${r.note} |`).join('\n')}
`);

console.log(report.join('\n'));
console.log(`\n${report.filter((r) => r.includes('→')).length} specs written to tests/katalon/`);
