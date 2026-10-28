import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { EnvName } from '../config/environments';

/** Git-ignored workbook: sheet "Credentials", columns Environment | Role | Username | Password. */
export const CREDENTIALS_XLSX = path.resolve(__dirname, '..', '.auth', 'credentials.xlsx');

export interface Credentials {
  username: string;
  password: string;
  source: string;
}

const text = (v: ExcelJS.CellValue) => (v == null ? '' : String(typeof v === 'object' && 'text' in v ? v.text : v).trim());

/**
 * Login for `env`. E2E_USERNAME / E2E_PASSWORD from the shell or .env win; otherwise the row of
 * .auth/credentials.xlsx whose Environment matches. Returns undefined when neither has one.
 */
export async function loadCredentials(env: EnvName): Promise<Credentials | undefined> {
  const { E2E_USERNAME, E2E_PASSWORD } = process.env;
  if (E2E_USERNAME && E2E_PASSWORD) return { username: E2E_USERNAME, password: E2E_PASSWORD, source: 'environment' };
  if (!fs.existsSync(CREDENTIALS_XLSX)) return undefined;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CREDENTIALS_XLSX);
  const ws = wb.getWorksheet('Credentials');
  if (!ws) throw new Error(`${CREDENTIALS_XLSX} has no "Credentials" sheet`);
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map(text);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 1) throw new Error(`${CREDENTIALS_XLSX}: column "${name}" not found in row 1`);
    return i;
  };
  const [envCol, userCol, passCol] = [col('Environment'), col('Username'), col('Password')];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (text(row.getCell(envCol).value).toUpperCase() !== env) continue;
    const username = text(row.getCell(userCol).value);
    const password = text(row.getCell(passCol).value);
    if (username && password) return { username, password, source: 'credentials.xlsx' };
  }
  return undefined;
}
