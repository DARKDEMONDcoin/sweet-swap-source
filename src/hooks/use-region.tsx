import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { REGIONS, type Region } from "@/data/team-portraits";

const STORAGE_KEY = "sahl.region";

/** خرائط المناطق الزمنية لكل بلد عربي → الزي الإقليمي الأقرب. */
const ZONE_REGION: Record<string, Region> = {
  "Asia/Riyadh": "gulf",
  "Asia/Kuwait": "gulf",
  "Asia/Qatar": "gulf",
  "Asia/Bahrain": "gulf",
  "Asia/Dubai": "gulf",
  "Asia/Muscat": "gulf",
  "Asia/Aden": "gulf",
  "Africa/Cairo": "eg",
  "Africa/Khartoum": "eg",
  "Asia/Amman": "sham",
  "Asia/Beirut": "sham",
  "Asia/Damascus": "sham",
  "Asia/Jerusalem": "sham",
  "Asia/Hebron": "sham",
  "Asia/Gaza": "sham",
  "Asia/Baghdad": "sham",
  "Africa/Casablanca": "maghreb",
  "Africa/El_Aaiun": "maghreb",
  "Africa/Algiers": "maghreb",
  "Africa/Tunis": "maghreb",
  "Africa/Tripoli": "maghreb",
  "Africa/Nouakchott": "maghreb",
};

function detectRegion(): Region {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && ZONE_REGION[zone]) return ZONE_REGION[zone];
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.includes("-eg") || lang.includes("-sd")) return "eg";
    if (/-(jo|lb|sy|ps|iq)$/.test(lang)) return "sham";
    if (/-(ma|dz|tn|ly|mr)$/.test(lang)) return "maghreb";
  } catch {
    /* تجاهل */
  }
  return "gulf";
}

type Ctx = { region: Region; setRegion: (r: Region) => void; auto: boolean };

const RegionContext = createContext<Ctx>({ region: "gulf", setRegion: () => {}, auto: true });

export function RegionProvider({ children }: { children: React.ReactNode }) {
  // نبدأ دائماً بالخليج حتى يتطابق الخادم مع المتصفح، ثم نكتشف البلد بعد التحميل.
  const [region, setRegionState] = useState<Region>("gulf");
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Region | null;
    if (saved && (REGIONS as readonly string[]).includes(saved)) {
      setRegionState(saved);
      setAuto(false);
      return;
    }
    setRegionState(detectRegion());
  }, []);

  const setRegion = useCallback((r: Region) => {
    setRegionState(r);
    setAuto(false);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* تجاهل */
    }
  }, []);

  const value = useMemo(() => ({ region, setRegion, auto }), [region, setRegion, auto]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export const useRegion = () => useContext(RegionContext);
