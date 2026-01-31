import React from 'react';
import type { AppSettings } from './settings';
import { loadSettings, saveSettings } from './settings';

type Ctx = {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
};

const SettingsContext = React.createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = React.useState<AppSettings>(() => loadSettings());

  const setSettings = React.useCallback((s: AppSettings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  return <SettingsContext.Provider value={{ settings, setSettings }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) throw new Error('SettingsProvider missing');
  return ctx;
}
