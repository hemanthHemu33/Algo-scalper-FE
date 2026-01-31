import axios from 'axios';
import type { AppSettings } from './settings';

export function buildUrl(baseUrl: string, path: string) {
  const b = baseUrl.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export async function getJson<T>(settings: AppSettings, path: string, params?: any): Promise<T> {
  const url = buildUrl(settings.baseUrl, path);
  const headers: Record<string, string> = {};
  if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
  const res = await axios.get(url, { params, headers });
  return res.data as T;
}

export async function postJson<T>(settings: AppSettings, path: string, body?: any): Promise<T> {
  const url = buildUrl(settings.baseUrl, path);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
  const res = await axios.post(url, body ?? {}, { headers });
  return res.data as T;
}
