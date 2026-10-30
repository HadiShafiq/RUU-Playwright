import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { ElementHandle, Locator, Page, TestInfo } from '@playwright/test';
import repository from './object-repository.json';
import overrides from './data-overrides.json';
import { waitForAjaxIdle } from '../primefaces';
import './groovy';

/*
 * Katalon WebUI on Playwright. The converted specs under tests/katalon/ are the Katalon Groovy scripts
 * translated line by line (scripts/katalon/convert.mjs); this module provides the Katalon API they call
 * (WebUI.*, findTestObject, TestObject, Keys, WebUiCommonHelper, ...) with Katalon's semantics:
 * timeouts in seconds, waitFor* return booleans, FailureHandling decides whether a failed step throws.
 */

const ROOT = path.resolve(__dirname, '..', '..');

interface Ctx {
  page: Page;
  testInfo: TestInfo;
  log: (m: string) => void;
  baseURL: string;
}
let ctx: Ctx | undefined;

/** Set by the Katalon fixture before each test. */
export function bindKatalon(c: Ctx) {
  ctx = c;
}
function cur(): Ctx {
  if (!ctx) throw new Error('Katalon runtime used outside a test (use fixtures/katalon.ts)');
  return ctx;
}

/* ---------------- Constants ---------------- */

export const FailureHandling = { STOP_ON_FAILURE: 'STOP_ON_FAILURE', CONTINUE_ON_FAILURE: 'CONTINUE_ON_FAILURE', OPTIONAL: 'OPTIONAL' } as const;
type FH = (typeof FailureHandling)[keyof typeof FailureHandling];

export const ConditionType = { EQUALS: 'EQUALS', CONTAINS: 'CONTAINS', STARTS_WITH: 'STARTS_WITH', ENDS_WITH: 'ENDS_WITH', NOT_EQUAL: 'NOT_EQUAL', MATCHES: 'MATCHES' } as const;

/** Selenium Keys → Playwright key names. Keys.chord(...) joins them into one press ("Control+a"). */
class Key {
  constructor(readonly name: string) {}
  toString() {
    return this.name;
  }
}
export class Chord {
  constructor(readonly keys: string[]) {}
}
export const Keys = {
  TAB: new Key('Tab'), ENTER: new Key('Enter'), RETURN: new Key('Enter'), ESCAPE: new Key('Escape'),
  BACK_SPACE: new Key('Backspace'), DELETE: new Key('Delete'), CONTROL: new Key('Control'), SHIFT: new Key('Shift'),
  ALT: new Key('Alt'), ARROW_DOWN: new Key('ArrowDown'), ARROW_UP: new Key('ArrowUp'), ARROW_LEFT: new Key('ArrowLeft'),
  ARROW_RIGHT: new Key('ArrowRight'), DOWN: new Key('ArrowDown'), UP: new Key('ArrowUp'), HOME: new Key('Home'), END: new Key('End'),
  PAGE_DOWN: new Key('PageDown'), PAGE_UP: new Key('PageUp'), SPACE: new Key('Space'),
  chord: (...keys: any[]) => new Chord(keys.map(String)),
};

/* ---------------- Test objects ---------------- */

const repo = repository as Record<string, { method: string; selector: string }>;

export class TestObject {
  private props: { name: string; condition: string; value: string }[] = [];
  constructor(private id = '') {}

  addProperty(name: string, condition: string, value: any) {
    this.props.push({ name, condition, value: String(value) });
    return this;
  }
  getObjectId() {
    return this.id;
  }
  setSelectorValue(_method: any, value: string) {
    this.props = [{ name: 'xpath', condition: ConditionType.EQUALS, value }];
  }

  /** Playwright selector: the xpath/css property, else an xpath built from the BASIC properties. */
  selector(): string {
    const xpath = this.props.find((p) => p.name === 'xpath');
    if (xpath) return `xpath=${xpath.value}`;
    const css = this.props.find((p) => p.name === 'css');
    if (css) return css.value;
    const tag = this.props.find((p) => p.name === 'tag')?.value ?? '*';
    const conds = this.props
      .filter((p) => p.name !== 'tag')
      .map((p) => {
        const attr = p.name === 'text' ? 'normalize-space(.)' : `@${p.name}`;
        const v = `'${p.value.replace(/'/g, "\\'")}'`;
        return p.condition === ConditionType.CONTAINS ? `contains(${attr},${v})` : `${attr}=${v}`;
      });
    if (!tag && !conds.length) throw new Error(`TestObject "${this.id}" has no selector`);
    return `xpath=//${tag}${conds.length ? `[${conds.join(' and ')}]` : ''}`;
  }
}

/** Object Repository lookup; "Object Repository/" prefix optional, as in Katalon. */
export function findTestObject(id: string, params?: Record<string, any>): TestObject {
  const key = id.replace(/^Object Repository\//, '');
  const entry = repo[key];
  if (!entry) throw new Error(`Object Repository entry not found: ${key}`);
  let selector = entry.selector;
  // Parameterised test objects: ${name} placeholders filled from params.
  for (const [k, v] of Object.entries(params ?? {})) selector = selector.split('${' + k + '}').join(String(v));
  const obj = new TestObject(key);
  obj.addProperty(entry.method === 'CSS' ? 'css' : 'xpath', ConditionType.EQUALS, selector);
  return obj;
}

const loc = (obj: TestObject | WebElement): Locator =>
  obj instanceof WebElement ? obj.locator : cur().page.locator(obj.selector()).first();

/* ---------------- Elements (Selenium WebElement) ---------------- */

export class WebElement {
  constructor(readonly locator: Locator) {}
  async elementHandle(): Promise<ElementHandle> {
    return (await this.locator.elementHandle())!;
  }
  click() {
    return likeSelenium(() => this.locator.click());
  }
  async getText() {
    return (await this.locator.innerText()).trim();
  }
  async getAttribute(name: string) {
    if (name === 'value') return this.locator.inputValue().catch(() => this.locator.getAttribute(name));
    return this.locator.getAttribute(name);
  }
  async getTagName() {
    return this.locator.evaluate((e) => e.tagName.toLowerCase());
  }
  isDisplayed() {
    return this.locator.isVisible();
  }
  isEnabled() {
    return this.locator.isEnabled();
  }
  isSelected() {
    return this.locator.evaluate((e: any) => !!(e.checked || e.selected));
  }
  clear() {
    return this.locator.fill('');
  }
  async sendKeys(...keys: any[]) {
    for (const k of keys) await typeKeys(this.locator, k);
  }
  async findElements(by: By) {
    return all(this.locator.locator(by.selector));
  }
  async findElement(by: By) {
    return new WebElement(this.locator.locator(by.selector).first());
  }
}

export class By {
  constructor(readonly selector: string) {}
  static xpath(x: string) {
    return new By(`xpath=${x}`);
  }
  static cssSelector(c: string) {
    return new By(c);
  }
  static id(id: string) {
    return new By(`[id="${id}"]`);
  }
}

async function all(l: Locator): Promise<WebElement[]> {
  const n = await l.count();
  return Array.from({ length: n }, (_, i) => new WebElement(l.nth(i)));
}

async function typeKeys(l: Locator, k: any) {
  if (k instanceof Chord) {
    const mods = k.keys.filter((x) => ['Control', 'Shift', 'Alt', 'Meta'].includes(x));
    const rest = k.keys.filter((x) => !mods.includes(x));
    if (!rest.length) return;
    for (const r of rest) await l.press([...mods, r].join('+'));
  } else if (k instanceof Key) await l.press(k.name);
  else await l.pressSequentially(String(k));
}

export const WebUiCommonHelper = {
  async findWebElement(obj: TestObject, timeout = 30) {
    const l = loc(obj);
    await l.waitFor({ state: 'attached', timeout: timeout * 1000 });
    return new WebElement(l);
  },
  async findWebElements(obj: TestObject, timeout = 30) {
    const l = cur().page.locator(obj.selector());
    await l.first().waitFor({ state: 'attached', timeout: timeout * 1000 }).catch(() => {});
    return all(l);
  },
};

export const DriverFactory = {
  getWebDriver() {
    return {
      findElements: (by: By) => all(cur().page.locator(by.selector)),
      findElement: async (by: By) => new WebElement(cur().page.locator(by.selector).first()),
      getCurrentUrl: () => cur().page.url(),
      executeScript: (script: string, ...args: any[]) => WebUI.executeJavaScript(script, args),
    };
  },
};

/* ---------------- WebUI ---------------- */

/** Katalon's default element timeout (seconds) when a keyword is called without one. */
const DEFAULT_TIMEOUT = 30;

/**
 * Before acting, let PrimeFaces finish the previous AJAX request (queue empty, no BlockUI). Selenium in Katalon
 * was slow enough not to need it; Playwright can click a tab while the last postback is still running, and
 * PrimeFaces then drops the click. A dialog's modal backdrop is not waited for (we may be clicking in it).
 */
async function settle() {
  await waitForAjaxIdle(cur().page, DEFAULT_TIMEOUT * 1000, { dialogOpen: true }).catch(() => {});
}

/**
 * Selenium's click/sendKeys block until a page load they trigger has finished (e.g. Login → dashboard);
 * Playwright returns at once. Katalon scripts rely on the Selenium behaviour (they select the language right
 * after Login), so: if the action starts a main-frame navigation, wait for the new page's load event.
 */
async function likeSelenium(action: () => Promise<unknown>) {
  const page = cur().page;
  let navigating = false;
  let loaded = false;
  const onRequest = (r: any) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) (navigating = true), (loaded = false);
  };
  const onLoad = () => (loaded = true);
  page.on('request', onRequest);
  page.on('load', onLoad);
  try {
    await action();
    await page.waitForTimeout(300);
    if (navigating && !loaded) await page.waitForEvent('load', { timeout: 60_000 }).catch(() => {});
  } finally {
    page.off('request', onRequest);
    page.off('load', onLoad);
  }
}

async function step<T>(name: string, fh: FH | undefined, onFail: T, body: () => Promise<T>): Promise<T> {
  try {
    await settle();
    return await body();
  } catch (e: any) {
    const mode = fh ?? FailureHandling.STOP_ON_FAILURE;
    if (mode === FailureHandling.STOP_ON_FAILURE) throw e;
    // OPTIONAL steps fail all the time by design (e.g. "is the BlockUI overlay there?"), so they stay quiet.
    if (mode === FailureHandling.CONTINUE_ON_FAILURE) {
      cur().log(`Continue-on-failure step failed: ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
      cur().testInfo.annotations.push({ type: 'warning', description: `${name} failed` });
    }
    return onFail;
  }
}

const isFH = (v: any): v is FH => typeof v === 'string' && v in FailureHandling;
/** Katalon overloads: (obj, timeout?, fh?) or (obj, fh?). */
const tf = (a?: any, b?: any): [number, FH | undefined] => (isFH(a) ? [DEFAULT_TIMEOUT, a] : [a ?? DEFAULT_TIMEOUT, b]);
const name = (o: TestObject | WebElement) => (o instanceof TestObject ? o.getObjectId() || o.selector() : 'element');

/**
 * Katalon's waitFor* keywords log a warning and return false on timeout, whatever the FailureHandling
 * (it only applies to other errors). The shared helpers rely on that: c() waits 1 s for "clickable", then clicks anyway.
 */
async function waitState(obj: TestObject, state: 'visible' | 'hidden' | 'attached', seconds: number, _fh?: FH) {
  try {
    await loc(obj).waitFor({ state, timeout: Number(seconds) * 1000 });
    return true;
  } catch {
    return false;
  }
}

export const WebUI = {
  async delay(seconds: number) {
    await cur().page.waitForTimeout(Number(seconds) * 1000);
  },
  comment(m: any) {
    cur().log(String(m));
  },
  async navigateToUrl(url: string) {
    // Katalon scripts hard-code SIT (or UAT); go to the same path on the environment under test.
    const u = new URL(url);
    if (/eperolehan\.com\.my$/.test(u.host) && !/sso/.test(u.host)) {
      const base = new URL(cur().baseURL);
      u.protocol = base.protocol;
      u.host = base.host;
    }
    await cur().page.goto(u.toString());
  },
  async maximizeWindow() {},
  async waitForPageLoad(seconds = DEFAULT_TIMEOUT, fh?: FH) {
    return step('waitForPageLoad', fh ?? FailureHandling.OPTIONAL, false, async () => {
      await cur().page.waitForLoadState('load', { timeout: seconds * 1000 });
      return true;
    });
  },
  async closeBrowser() {
    cur().log('closeBrowser (the fixture closes the browser at the end of the test)');
  },
  async refresh() {
    await cur().page.reload();
  },
  async switchToDefaultContent() {},
  async takeScreenshot(file?: string) {
    const body = await cur().page.screenshot();
    await cur().testInfo.attach(file ? path.basename(file) : 'katalon-screenshot', { body, contentType: 'image/png' });
    return file ?? '';
  },

  async click(obj: TestObject, fh?: FH) {
    return step(`click ${name(obj)}`, fh, undefined, () => likeSelenium(() => loc(obj).click({ timeout: DEFAULT_TIMEOUT * 1000 })));
  },
  async enhancedClick(obj: TestObject, fh?: FH) {
    return step(`enhancedClick ${name(obj)}`, fh, undefined, async () => {
      const l = loc(obj);
      await l.scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT * 1000 });
      await likeSelenium(() => l.click({ timeout: DEFAULT_TIMEOUT * 1000 }).catch(() => l.dispatchEvent('click')));
    });
  },
  async doubleClick(obj: TestObject, fh?: FH) {
    return step(`doubleClick ${name(obj)}`, fh, undefined, () => likeSelenium(() => loc(obj).dblclick({ timeout: DEFAULT_TIMEOUT * 1000 })));
  },
  /**
   * Katalon setText = clear, then Selenium sendKeys: real key events, which autocompletes (UOM) and masked
   * number fields react to. Playwright's fill() sets the value without them, so type instead.
   */
  async setText(obj: TestObject, text: any, fh?: FH) {
    return step(`setText ${name(obj)}`, fh, undefined, async () => {
      const l = loc(obj);
      await l.fill('', { timeout: DEFAULT_TIMEOUT * 1000 });
      await l.pressSequentially(text == null ? '' : String(text));
    });
  },
  async setEncryptedText(obj: TestObject, text: any, fh?: FH) {
    return WebUI.setText(obj, text, fh);
  },
  async clearText(obj: TestObject, fh?: FH) {
    return step(`clearText ${name(obj)}`, fh, undefined, () => loc(obj).fill(''));
  },
  async sendKeys(obj: TestObject, keys: any, fh?: FH) {
    return step(`sendKeys ${name(obj)}`, fh, undefined, () => likeSelenium(() => typeKeys(loc(obj), keys)));
  },
  async uploadFile(obj: TestObject, file: string, fh?: FH) {
    return step(`uploadFile ${name(obj)}`, fh, undefined, () => loc(obj).setInputFiles(path.resolve(file)));
  },
  async scrollToElement(obj: TestObject, seconds?: any, fh?: FH) {
    const [, f] = tf(seconds, fh);
    return step(`scrollToElement ${name(obj)}`, f, undefined, () => loc(obj).scrollIntoViewIfNeeded({ timeout: tf(seconds)[0] * 1000 }));
  },
  async selectOptionByValue(obj: TestObject, value: any, isRegex = false, fh?: FH) {
    return step(`selectOptionByValue ${name(obj)}`, fh, undefined, async () => {
      const l = loc(obj);
      if (!isRegex) return likeSelenium(() => l.selectOption({ value: String(value) }));
      const re = new RegExp(`^${value}$`);
      const values = await l.locator('option').evaluateAll((os) => os.map((o: any) => o.value));
      await likeSelenium(() => l.selectOption({ value: values.find((v) => re.test(v)) ?? String(value) }));
    });
  },
  async selectOptionByLabel(obj: TestObject, label: any, isRegex = false, fh?: FH) {
    return step(`selectOptionByLabel ${name(obj)}`, fh, undefined, async () => {
      const l = loc(obj);
      if (!isRegex) return likeSelenium(() => l.selectOption({ label: String(label) }));
      const re = new RegExp(`^${label}$`);
      const labels = await l.locator('option').evaluateAll((os) => os.map((o: any) => o.textContent.trim()));
      await likeSelenium(() => l.selectOption({ label: labels.find((v) => re.test(v)) ?? String(label) }));
    });
  },
  async selectOptionByIndex(obj: TestObject, index: any, fh?: FH) {
    return step(`selectOptionByIndex ${name(obj)}`, fh, undefined, () => likeSelenium(() => loc(obj).selectOption({ index: Number(index) })));
  },
  async getText(obj: TestObject, fh?: FH) {
    return step(`getText ${name(obj)}`, fh, '', async () => (await loc(obj).innerText({ timeout: DEFAULT_TIMEOUT * 1000 })).trim());
  },
  async getAttribute(obj: TestObject, attr: string, fh?: FH) {
    return step(`getAttribute ${name(obj)}`, fh, null as any, async () => {
      const l = loc(obj);
      if (attr === 'value') return l.inputValue({ timeout: DEFAULT_TIMEOUT * 1000 }).catch(() => l.getAttribute('value'));
      return l.getAttribute(attr, { timeout: DEFAULT_TIMEOUT * 1000 });
    });
  },
  async findWebElement(obj: TestObject, seconds = DEFAULT_TIMEOUT) {
    return WebUiCommonHelper.findWebElement(obj, seconds);
  },
  async findWebElements(obj: TestObject, seconds = DEFAULT_TIMEOUT) {
    return WebUiCommonHelper.findWebElements(obj, seconds);
  },

  waitForElementVisible: (obj: TestObject, s?: any, fh?: FH) => waitState(obj, 'visible', ...tf(s, fh)),
  waitForElementNotVisible: (obj: TestObject, s?: any, fh?: FH) => waitState(obj, 'hidden', ...tf(s, fh)),
  waitForElementPresent: (obj: TestObject, s?: any, fh?: FH) => waitState(obj, 'attached', ...tf(s, fh)),
  async waitForElementClickable(obj: TestObject, s?: any, fh?: FH) {
    const [seconds, f] = tf(s, fh);
    if (!(await waitState(obj, 'visible', seconds, f))) return false;
    const end = Date.now() + seconds * 1000;
    do {
      if (await loc(obj).isEnabled().catch(() => false)) return true;
      await cur().page.waitForTimeout(100);
    } while (Date.now() < end);
    return false;
  },

  /** verify* keywords fail the test unless FailureHandling says otherwise. */
  async verifyElementPresent(obj: TestObject, s?: any, fh?: FH) {
    const [seconds, f] = tf(s, fh);
    return step(`verifyElementPresent ${name(obj)}`, f, false, async () => {
      await loc(obj).waitFor({ state: 'attached', timeout: seconds * 1000 });
      return true;
    });
  },
  async verifyElementNotPresent(obj: TestObject, s?: any, fh?: FH) {
    const [seconds, f] = tf(s, fh);
    return step(`verifyElementNotPresent ${name(obj)}`, f, false, async () => {
      await loc(obj).waitFor({ state: 'detached', timeout: seconds * 1000 });
      return true;
    });
  },
  async verifyElementVisible(obj: TestObject, fh?: FH) {
    return step(`verifyElementVisible ${name(obj)}`, fh, false, async () => {
      if (!(await loc(obj).isVisible())) throw new Error(`${name(obj)} is not visible`);
      return true;
    });
  },
  async verifyElementClickable(obj: TestObject, fh?: FH) {
    return step(`verifyElementClickable ${name(obj)}`, fh, false, async () => {
      const l = loc(obj);
      if (!((await l.isVisible()) && (await l.isEnabled()))) throw new Error(`${name(obj)} is not clickable`);
      return true;
    });
  },
  async verifyElementText(obj: TestObject, text: any, fh?: FH) {
    return step(`verifyElementText ${name(obj)}`, fh, false, async () => {
      const actual = (await loc(obj).innerText()).trim();
      if (actual !== String(text)) throw new Error(`Text of ${name(obj)} is "${actual}", expected "${text}"`);
      return true;
    });
  },
  async verifyTextPresent(text: string, isRegex = false, fh?: FH) {
    return step(`verifyTextPresent ${text}`, fh, false, async () => {
      const body = await cur().page.locator('body').innerText();
      if (!(isRegex ? new RegExp(text).test(body) : body.includes(text))) throw new Error(`Text not present: ${text}`);
      return true;
    });
  },

  /** Selenium executeScript: `arguments[i]` are the given args (WebElements become DOM elements). */
  async executeJavaScript(script: string, args?: any[] | null) {
    const list = await Promise.all((args ?? []).map(async (a) => (a instanceof WebElement ? a.elementHandle() : a)));
    return cur().page.evaluate(([src, a]) => new Function(src as string).apply(null, a as any[]), [script, list] as const);
  },
};

/**
 * On the Task List page: if `docNo` is in Group Task (a task assigned to several officers, e.g. Submit FD),
 * claim it so it moves to My Task, where the Katalon scripts search. Same steps as Katalon's
 * WebHelper.claimDocument (look through up to 10 pages, click Claim). Does nothing if it isn't there.
 */
export async function claimGroupTaskIfAny(docNo: any) {
  const page = cur().page;
  const doc = String(docNo ?? '').trim();
  if (!doc) return false;
  await settle();
  const groupBody = page.locator('tbody[id*="taskListGroupId_data"]').first();
  if (!(await groupBody.count())) return false;
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const row = groupBody.locator('tr').filter({ has: page.locator(`td`, { hasText: new RegExp(`^\\s*${doc}\\s*$`) }) });
    if (await row.count()) {
      await row.first().locator('button', { hasText: 'Claim' }).first().click();
      await settle();
      await page.waitForTimeout(1000);
      cur().log(`Claimed group task ${doc} (moved to My Task)`);
      return true;
    }
    const next = page.locator(`xpath=(//span[contains(@class,'ui-paginator-pages')])[1]/span[normalize-space()='${pageNo + 1}']`);
    if (!(await next.count())) break;
    await next.click();
    await settle();
  }
  cur().log(`${doc} is not in Group Task (nothing to claim)`);
  return false;
}

export const KeywordUtil = {
  logInfo: (m: any) => cur().log(String(m)),
  markWarning: (m: any) => {
    cur().log(`WARNING: ${m}`);
    cur().testInfo.annotations.push({ type: 'warning', description: String(m) });
  },
  markPassed: (m: any) => cur().log(String(m)),
  markFailed: (m: any) => {
    throw new Error(String(m));
  },
  markFailedAndStop: (m: any) => {
    throw new Error(String(m));
  },
};

/* ---------------- Groovy / Java library ---------------- */

export function println(...m: any[]) {
  cur().log(m.map(String).join(' '));
}

/** Groovy `assert cond : message`. */
export function gAssert(cond: any, message?: any): asserts cond {
  if (!cond) throw new Error(message == null ? 'Assertion failed' : String(message));
}

/** Groovy `text =~ /re/`: a java.util.regex.Matcher with find()/group(). */
export function groovyMatcher(text: any, re: RegExp | string) {
  const g = new RegExp(typeof re === 'string' ? re : re.source, 'g' + (typeof re === 'string' ? '' : re.flags.replace('g', '')));
  const s = String(text ?? '');
  let m: RegExpExecArray | null = null;
  const first = new RegExp(g.source, g.flags.replace('g', '')).exec(s);
  return {
    find() {
      m = g.exec(s);
      return m !== null;
    },
    matches: () => new RegExp(`^(?:${g.source})$`).test(s),
    group: (i = 0) => (m ?? first)?.[i] ?? null,
    getCount: () => (s.match(g) ?? []).length,
    /** Groovy indexing: (text =~ re)[0][1] */
    0: first,
    get size() {
      return (s.match(g) ?? []).length;
    },
  } as any;
}

/** Groovy `text ==~ /re/` (whole-string match). */
export const groovyFullMatch = (text: any, re: RegExp) => new RegExp(`^(?:${re.source})$`, re.flags).test(String(text ?? ''));

export const Arrays = { asList: (...a: any[]) => a };

/** Where Katalon's user.dir and user.home point (see README "Katalon conversion"). */
const KATALON_HOME = process.env.KATALON_HOME ? path.resolve(process.env.KATALON_HOME) : path.join(ROOT, 'reports', 'katalon-home');
export const System = {
  getProperty(k: string) {
    if (k === 'user.dir') return path.join(ROOT, 'fixtures', 'katalon'); // has TestData/UploadFiles
    if (k === 'user.home') return KATALON_HOME;
    if (k === 'file.separator') return '/';
    if (k === 'line.separator') return '\n';
    return '';
  },
  getenv: (k: string) => process.env[k] ?? null,
  currentTimeMillis: () => Date.now(),
  setProperty: () => {},
};

export const Thread = { sleep: (ms: number) => cur().page.waitForTimeout(ms) };

const JAVA_TOKENS: Record<string, (d: Date) => string> = {
  yyyy: (d) => String(d.getFullYear()), yy: (d) => String(d.getFullYear()).slice(-2),
  MMMM: (d) => d.toLocaleString('en-GB', { month: 'long' }), MMM: (d) => d.toLocaleString('en-GB', { month: 'short' }),
  MM: (d) => String(d.getMonth() + 1).padStart(2, '0'), M: (d) => String(d.getMonth() + 1),
  dd: (d) => String(d.getDate()).padStart(2, '0'), d: (d) => String(d.getDate()),
  HH: (d) => String(d.getHours()).padStart(2, '0'), H: (d) => String(d.getHours()),
  hh: (d) => String(d.getHours() % 12 || 12).padStart(2, '0'), mm: (d) => String(d.getMinutes()).padStart(2, '0'),
  ss: (d) => String(d.getSeconds()).padStart(2, '0'), SSS: (d) => String(d.getMilliseconds()).padStart(3, '0'),
  a: (d) => (d.getHours() < 12 ? 'AM' : 'PM'), EEE: (d) => d.toLocaleString('en-GB', { weekday: 'short' }),
};
export function formatJavaDate(pattern: string, d: Date) {
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|mm|ss|SSS|a|EEE|'[^']*'/g, (t) => (t.startsWith("'") ? t.slice(1, -1) : JAVA_TOKENS[t](d)));
}
export class SimpleDateFormat {
  constructor(private pattern: string) {}
  format(d: Date | number) {
    return formatJavaDate(this.pattern, new Date(d));
  }
}

/** java.time.LocalDate: now(), plusDays(), format(DateTimeFormatter.ofPattern(...)). */
export class LocalDate {
  constructor(private d: Date) {}
  static now() {
    const n = new Date();
    return new LocalDate(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
  }
  plusDays(n: number) {
    return new LocalDate(new Date(this.d.getFullYear(), this.d.getMonth(), this.d.getDate() + Number(n)));
  }
  minusDays(n: number) {
    return this.plusDays(-n);
  }
  plusMonths(n: number) {
    return new LocalDate(new Date(this.d.getFullYear(), this.d.getMonth() + Number(n), this.d.getDate()));
  }
  getDayOfMonth() {
    return this.d.getDate();
  }
  getMonthValue() {
    return this.d.getMonth() + 1;
  }
  getYear() {
    return this.d.getFullYear();
  }
  format(f: { pattern: string }) {
    return formatJavaDate(f.pattern, this.d);
  }
  toString() {
    return formatJavaDate('yyyy-MM-dd', this.d);
  }
}
export const DateTimeFormatter = { ofPattern: (pattern: string) => ({ pattern }) };

export class File {
  constructor(readonly path: string) {}
  mkdirs() {
    fs.mkdirSync(this.path, { recursive: true });
    return true;
  }
  exists() {
    return fs.existsSync(this.path);
  }
  isFile() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isFile();
  }
  getName() {
    return path.basename(this.path);
  }
  getAbsolutePath() {
    return path.resolve(this.path);
  }
}
export const Paths = { get: (...p: string[]) => path.join(...p) };
export const Files = { exists: (p: string) => fs.existsSync(p) };
export class FileInputStream {
  constructor(readonly path: string) {}
  close() {}
}
export class FileOutputStream {
  constructor(readonly path: string) {}
  flush() {}
  close() {}
}

/**
 * Apache POI XSSFWorkbook, just enough for the Katalon scripts' "append result to Excel" blocks.
 * The file is not read when opened (POI reads synchronously, exceljs can't), so row numbers the script
 * computes from it are not used: a workbook opened from an existing file appends the rows created in this
 * session after the file's last row; a new workbook writes its rows (header first) as they are.
 */
export class XSSFWorkbook {
  private sheets = new Map<string, Sheet>();
  constructor(readonly source?: FileInputStream) {}
  getSheet(n: string) {
    return this.source ? (this.sheets.get(n) ?? this.createSheet(n)) : (this.sheets.get(n) ?? null);
  }
  createSheet(n: string) {
    const s = new Sheet(n);
    this.sheets.set(n, s);
    return s;
  }
  async write(out: FileOutputStream) {
    const wb = new ExcelJS.Workbook();
    if (fs.existsSync(out.path)) await wb.xlsx.readFile(out.path);
    for (const s of this.sheets.values()) {
      const ws = wb.getWorksheet(s.name) ?? wb.addWorksheet(s.name);
      for (const [, r] of [...s.rows.entries()].sort(([a], [b]) => a - b)) ws.addRow(r.values());
    }
    fs.mkdirSync(path.dirname(out.path), { recursive: true });
    await wb.xlsx.writeFile(out.path);
    cur().log(`Result appended to ${out.path}`);
  }
  close() {}
}
class Sheet {
  rows = new Map<number, Row>();
  constructor(readonly name: string) {}
  createRow(i: number) {
    const r = new Row();
    this.rows.set(i, r);
    return r;
  }
  getRow(i: number) {
    return this.rows.get(i) ?? null;
  }
  getLastRowNum() {
    return Math.max(0, ...this.rows.keys());
  }
  getPhysicalNumberOfRows() {
    return this.rows.size;
  }
}
class Row {
  private cells: any[] = [];
  createCell(i: number) {
    return { setCellValue: (v: any) => void (this.cells[i] = v) };
  }
  values() {
    return this.cells;
  }
}

/* ---------------- Test case variables ---------------- */

/** How a Katalon test suite binds a data file to the test case's variables. */
export interface DataBinding {
  suite: string;
  dataFile: string;
  /** Excel path in the Katalon data file (usually another user's machine); only its file name is used. */
  source: string;
  sheet: string;
  /** variable → data column */
  columns: Record<string, string>;
}

let currentVars: Record<string, any> = {};

/** Groovy script binding: test case variables by name (binding.getVariable("Ministry1")). */
export const binding = {
  getVariable(n: string) {
    if (!(n in currentVars)) throw new Error(`MissingPropertyException: No such property: ${n} (not a variable of this Katalon test case)`);
    return currentVars[n];
  },
  hasVariable: (n: string) => n in currentVars,
  getVariables: () => currentVars,
};

/**
 * A name the Katalon script uses without defining it where it is used (see knowledge/katalon-script-defects.md).
 * Katalon stops there; so does this, unless the value is given as KAT_<name>.
 */
export function katalonMissing(n: string): any {
  if (process.env[`KAT_${n}`] !== undefined) return process.env[`KAT_${n}`];
  throw new Error(`Katalon script defect: "${n}" is not defined where the Katalon script uses it (Katalon stops here too). Set KAT_${n} to supply a value.`);
}

/** Folder searched (recursively) for the bound Excel files. */
export const KATALON_DATA_DIR = process.env.KATALON_DATA_DIR ?? path.join(os.homedir(), 'Desktop', 'Data Prep Excel AP 201');

function findFile(dir: string, base: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === base.toLowerCase()) return p;
    if (e.isDirectory()) {
      const f = findFile(p, base);
      if (f) return f;
    }
  }
  return undefined;
}

const cellText = (c: ExcelJS.CellValue): string =>
  c == null ? '' : typeof c === 'object' ? ('text' in c ? String(c.text) : 'result' in c ? String(c.result ?? '') : c instanceof Date ? c.toISOString() : String(c)) : String(c);

/**
 * Values for the test case's variables, in Katalon's order of precedence (lowest first):
 *   1. defaults from the .tc file (passed in by the spec), corrected by support/katalon/data-overrides.json
 *   2. login defaults kept out of git in .auth/katalon-variables.json (scripts/katalon/convert.mjs writes it)
 *   3. the suite's data file row DATA_ROW (default 1), when the Excel file is found under KATALON_DATA_DIR
 *   4. environment variables KAT_<Variable>
 */
export async function katalonVariables(caseId: string, defaults: Record<string, any>, binding?: DataBinding): Promise<Record<string, any>> {
  const vars: Record<string, any> = { ...defaults };
  const { _why, ...corrections } = (overrides as unknown as Record<string, Record<string, any>>)[caseId] ?? {};
  if (_why) cur().log(`Test data corrected (support/katalon/data-overrides.json): ${Object.keys(corrections).join(', ')}: ${_why}`);
  // "{MMddHHmmss}" etc. in a correction: the run's time in that Java date pattern (for values SIT wants unique);
  // "{yyyy-MM-dd+180d}": that many days from today (for dates SIT wants in the future).
  const now = new Date();
  const expand = (_: string, p: string, days?: string) => formatJavaDate(p, new Date(now.getTime() + Number(days ?? 0) * 86_400_000));
  for (const [k, v] of Object.entries(corrections))
    vars[k] = typeof v === 'string' ? v.replace(/\{([yMdHms][yMdHms\-/.: ]*?)(?:\+(\d+)d)?\}/g, expand) : v;
  const secretFile = path.join(ROOT, '.auth', 'katalon-variables.json');
  if (fs.existsSync(secretFile)) Object.assign(vars, JSON.parse(fs.readFileSync(secretFile, 'utf8'))[caseId] ?? {});

  if (binding && !process.env.KATALON_NO_DATA) {
    const file = findFile(KATALON_DATA_DIR, path.win32.basename(binding.source));
    if (!file) {
      cur().log(`Data file "${path.win32.basename(binding.source)}" (${binding.dataFile}) not found under ${KATALON_DATA_DIR}; using test case defaults`);
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const ws = (binding.sheet && wb.getWorksheet(binding.sheet)) || wb.worksheets[0];
      const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => cellText(v).trim());
      const n = Number(process.env.DATA_ROW ?? 1);
      const row = ws.getRow(n + 1).values as ExcelJS.CellValue[];
      for (const [v, col] of Object.entries(binding.columns)) {
        const i = header.indexOf(col);
        if (i > 0) vars[v] = cellText(row[i]).trim();
      }
      cur().log(`Variables from ${path.relative(KATALON_DATA_DIR, file)} [${ws.name}] row ${n}`);
    }
  }
  for (const k of Object.keys(vars)) if (process.env[`KAT_${k}`] !== undefined) vars[k] = process.env[`KAT_${k}`];
  currentVars = vars;
  const missing = Object.entries(vars).filter(([k, v]) => /^(username|password)$/i.test(k) && (v == null || v === ''));
  if (missing.length)
    throw new Error(`${missing.map(([k]) => k).join(', ')} not set for ${caseId}: run "npm run katalon:convert" (writes .auth/katalon-variables.json) or set KAT_<Variable>`);
  return vars;
}
