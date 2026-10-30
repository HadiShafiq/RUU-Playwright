/*
 * Groovy/Java String, Number and List methods the converted Katalon scripts call
 * (e.g. value.toString().trim().toInteger(), a.equalsIgnoreCase(b), list.size()).
 * Only loaded by support/katalon/runtime.ts, i.e. only in tests/katalon specs.
 */
export {};

declare global {
  interface String {
    toInteger(): number;
    toDouble(): number;
    toBigDecimal(): number;
    isInteger(): boolean;
    isNumber(): boolean;
    isEmpty(): boolean;
    size(): number;
    contains(s: any): boolean;
    equals(o: any): boolean;
    equalsIgnoreCase(o: any): boolean;
    tokenize(sep?: string): string[];
    padLeft(n: number, c?: string): string;
    padRight(n: number, c?: string): string;
    toCharArray(): string[];
    matches(re: string): boolean;
    intValue(): number;
    getClass(): { getName(): string; getSimpleName(): string };
  }
  interface Number {
    toInteger(): number;
    intValue(): number;
    equals(o: any): boolean;
    getClass(): { getName(): string; getSimpleName(): string };
  }
  interface Array<T> {
    size(): number;
    isEmpty(): boolean;
    contains(o: any): boolean;
    get(i: number): T;
    add(o: T): boolean;
  }
}

function define(proto: object, name: string, fn: Function) {
  if (!Object.prototype.hasOwnProperty.call(proto, name)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
}

const S = String.prototype;
define(S, 'toInteger', function (this: string) {
  return Math.trunc(Number(this.trim()));
});
define(S, 'intValue', function (this: string) {
  return Math.trunc(Number(this.trim()));
});
define(S, 'toDouble', function (this: string) {
  return Number(this.trim());
});
define(S, 'toBigDecimal', function (this: string) {
  return Number(this.trim());
});
define(S, 'isInteger', function (this: string) {
  return /^[+-]?\d+$/.test(this.trim());
});
define(S, 'isNumber', function (this: string) {
  return this.trim() !== '' && !Number.isNaN(Number(this.trim()));
});
define(S, 'isEmpty', function (this: string) {
  return this.length === 0;
});
define(S, 'size', function (this: string) {
  return this.length;
});
define(S, 'contains', function (this: string, s: any) {
  return this.includes(String(s));
});
define(S, 'equals', function (this: string, o: any) {
  return o != null && String(this) === String(o);
});
define(S, 'equalsIgnoreCase', function (this: string, o: any) {
  return o != null && this.toLowerCase() === String(o).toLowerCase();
});
define(S, 'tokenize', function (this: string, sep = ' \t\n') {
  return this.split(new RegExp(`[${sep.replace(/[\]\\^-]/g, '\\$&')}]+`)).filter(Boolean);
});
define(S, 'padLeft', function (this: string, n: number, c = ' ') {
  return this.padStart(n, c);
});
define(S, 'padRight', function (this: string, n: number, c = ' ') {
  return this.padEnd(n, c);
});
define(S, 'toCharArray', function (this: string) {
  return [...this];
});
define(S, 'matches', function (this: string, re: string) {
  return new RegExp(`^(?:${re})$`).test(this);
});

const N = Number.prototype;
define(N, 'toInteger', function (this: number) {
  return Math.trunc(this as number);
});
define(N, 'intValue', function (this: number) {
  return Math.trunc(this as number);
});
define(N, 'equals', function (this: number, o: any) {
  return Number(this) === Number(o);
});

const A = Array.prototype;
define(A, 'size', function (this: any[]) {
  return this.length;
});
define(A, 'isEmpty', function (this: any[]) {
  return this.length === 0;
});
define(A, 'contains', function (this: any[], o: any) {
  return this.includes(o);
});
define(A, 'get', function (this: any[], i: number) {
  return this[i];
});
define(A, 'add', function (this: any[], o: any) {
  this.push(o);
  return true;
});

/** value.getClass().getName(), used in the scripts' debug comments. */
define(S, 'getClass', function () {
  return { getName: () => 'java.lang.String', getSimpleName: () => 'String' };
});
define(N, 'getClass', function (this: number) {
  const n = Number.isInteger(this as number) ? 'Integer' : 'Double';
  return { getName: () => `java.lang.${n}`, getSimpleName: () => n };
});
